import type { AgentTool } from "@earendil-works/pi-agent-core";
import { momWarn } from "$lib/server/agent/common/log.js";
import { createHeadlessExtensionContext } from "$lib/server/plugins/piExtensions/context.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";

export interface PiExtensionToolOptions {
  cwd: string;
  /** Tool names already taken by built-ins or other sources; never overridden. */
  reservedToolNames: Set<string>;
  systemPrompt?: () => string;
}

export interface PiExtensionToolConflict {
  extensionId: string;
  toolName: string;
}

export interface PiExtensionToolsResult {
  tools: AgentTool<any>[];
  conflicts: PiExtensionToolConflict[];
}

/**
 * Convert one pi `ToolDefinition` into an `AgentTool`.
 *
 * pi's definition is a superset: it adds a trailing `ExtensionContext` argument
 * to `execute` plus terminal-only `renderCall`/`renderResult`. The renderers are
 * dropped (Molibot renders tool calls per channel) and the context is built per
 * invocation so it carries that call's abort signal.
 */
function toAgentTool(
  extension: LoadedPiExtension,
  toolName: string,
  options: PiExtensionToolOptions
): AgentTool<any> | null {
  const registered = extension.extension?.tools.get(toolName);
  const definition = registered?.definition as any
    ?? extension.tools?.find((tool) => tool.name === toolName);
  if (!definition) return null;

  return {
    name: definition.name,
    label: definition.label ?? definition.name,
    description: definition.description ?? "",
    parameters: definition.parameters,
    ...(definition.prepareArguments ? { prepareArguments: definition.prepareArguments } : {}),
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (extension.client) {
        const result = await extension.client.request("invokeTool", {
          extensionId: extension.id,
          toolName,
          toolCallId,
          params,
          cwd: options.cwd,
          systemPrompt: options.systemPrompt?.() ?? ""
        }, signal);
        for (const update of result.updates ?? []) onUpdate?.(update);
        return result.value;
      }
      const ctx = createHeadlessExtensionContext({
        cwd: options.cwd,
        signal,
        extensionId: extension.id,
        systemPrompt: options.systemPrompt
      });
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    }
  } as AgentTool<any>;
}

/**
 * Tools contributed by the active pi extensions.
 *
 * Built-in tools always win: an extension registering `read` or `bash` would
 * silently replace core behaviour, so the colliding tool is skipped and
 * reported as a conflict for the settings UI. Two extensions claiming the same
 * name resolve first-loaded-wins, same as pi.
 */
export function createPiExtensionTools(
  extensions: LoadedPiExtension[],
  options: PiExtensionToolOptions
): PiExtensionToolsResult {
  const tools: AgentTool<any>[] = [];
  const conflicts: PiExtensionToolConflict[] = [];
  const taken = new Set(options.reservedToolNames);

  for (const extension of extensions) {
    for (const toolName of extension.toolNames) {
      if (taken.has(toolName)) {
        conflicts.push({ extensionId: extension.id, toolName });
        momWarn("plugins", "pi_extension_tool_conflict", { extensionId: extension.id, toolName });
        continue;
      }
      const tool = toAgentTool(extension, toolName, options);
      if (!tool) continue;
      taken.add(toolName);
      tools.push(tool);
    }
  }

  return { tools, conflicts };
}

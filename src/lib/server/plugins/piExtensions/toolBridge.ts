import { randomUUID } from "node:crypto";
import type { AgentTool, AgentToolCallOutcome } from "@earendil-works/pi-agent-core";
import { momWarn } from "$lib/server/agent/common/log.js";
import { createHeadlessExtensionContext } from "$lib/server/plugins/piExtensions/context.js";
import type {
  LoadedPiExtension,
  PiExtensionProcessClient,
  PiExtensionRuntimeSnapshot
} from "$lib/server/plugins/piExtensions/types.js";

export interface PiExtensionToolOptions {
  cwd: string;
  /** Tool names already taken by built-ins or other sources; never overridden. */
  reservedToolNames: Set<string>;
  systemPrompt?: () => string;
  /** Real run state for the extension context, resolved per invocation. */
  runtime?: () => PiExtensionRuntimeSnapshot | undefined | Promise<PiExtensionRuntimeSnapshot | undefined>;
  /**
   * Run a nested tool through the shared ToolRuntime (permissions, approvals,
   * budgets). Omitted when the caller has no shared dispatcher.
   */
  executeTool?: (name: string, args: unknown, signal: AbortSignal | undefined, callerId: string) => Promise<AgentToolCallOutcome>;
  /**
   * Tools an extension may call, as `ctx.tools`. Exactly the set the model can
   * call, so an extension discovers what `executeTool` accepts.
   */
  toolCatalog?: () => Array<{ name: string; label: string; description: string; parameters: unknown }>;
  /** Abort the current run, for `ctx.abort()`. Available in every mode. */
  abort?: () => void;
  /** Trigger compaction for `ctx.compact()`, reusing the run's budget. */
  compact?: () => void | Promise<void>;
  /**
   * Model work behind `ctx.modelRegistry.classify`/`generateImages`; the shared
   * `ModelOperations` entry. Omitted when the caller cannot authorize it.
   */
  modelOperations?: Pick<import("$lib/server/agent/models/modelOperations.js").ModelOperations, "classify" | "generateImages">;
  /**
   * Chat streaming behind `ctx.modelRegistry.stream`/`streamSimple`/`complete`.
   * Pushes serialized provider events through `emit` and resolves the final
   * message. Omitted when the caller cannot authorize it.
   */
  streamModel?: (input: PiExtensionStreamInput, emit: (event: unknown) => void, signal: AbortSignal) => Promise<unknown>;
}

export interface PiExtensionStreamInput {
  model: { provider: string; id: string };
  context: unknown;
  options: unknown;
  simple: boolean;
}

/** The callable capabilities a host session exposes; a subset of the tool options. */
export type PiExtensionHostCapabilities = Pick<
  PiExtensionToolOptions,
  "executeTool" | "modelOperations" | "streamModel" | "abort" | "compact"
>;

export function bindPiExtensionHostSession(
  client: PiExtensionProcessClient,
  options: PiExtensionHostCapabilities,
  signal: AbortSignal | undefined,
  callerId: string
): string | undefined {
  if (!options.executeTool && !options.modelOperations && !options.streamModel && !options.abort && !options.compact) return undefined;
  const token = randomUUID();
  // One AbortController per in-flight stream so the extension can cancel it.
  const streams = new Map<string, AbortController>();
  client.registerHostSession(token, async (method, input, emit) => {
    if (method === "executeTool" && options.executeTool) {
      return options.executeTool(String(input?.toolName ?? ""), input?.args, signal, callerId);
    }
    if (method === "modelRegistry.classify" && options.modelOperations) {
      return options.modelOperations.classify({ model: input?.key, state: input?.state ?? {}, questions: input?.questions ?? {} }, signal);
    }
    if (method === "modelRegistry.generateImages" && options.modelOperations) {
      return options.modelOperations.generateImages({ model: input?.key, prompt: String(input?.prompt ?? ""), images: input?.images }, signal);
    }
    if (method === "modelRegistry.stream" && options.streamModel) {
      const streamId = String(input?.streamId ?? randomUUID());
      const controller = new AbortController();
      if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      streams.set(streamId, controller);
      try {
        return await options.streamModel({
          model: { provider: String(input?.model?.provider ?? ""), id: String(input?.model?.id ?? "") },
          context: input?.context,
          options: input?.options,
          simple: Boolean(input?.simple)
        }, emit, controller.signal);
      } finally {
        streams.delete(streamId);
      }
    }
    if (method === "modelRegistry.streamAbort") {
      streams.get(String(input?.streamId ?? ""))?.abort(new Error("Model stream aborted by the extension."));
      return null;
    }
    if (method === "abort" && options.abort) {
      options.abort();
      return null;
    }
    if (method === "compact" && options.compact) {
      await options.compact();
      return null;
    }
    throw new Error(`Unsupported extension host method: ${method}`);
  });
  return token;
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
        const runtime = await options.runtime?.();
        const hostToken = bindPiExtensionHostSession(extension.client, options, signal, toolCallId);
        const tools = options.toolCatalog?.();
        try {
          const result = await extension.client.request("invokeTool", {
            extensionId: extension.id,
            toolName,
            toolCallId,
            params,
            cwd: options.cwd,
            systemPrompt: options.systemPrompt?.() ?? "",
            ...(runtime ? { runtime } : {}),
            ...(tools ? { tools } : {}),
            ...(hostToken ? { hostToken } : {})
          }, signal);
          for (const update of result.updates ?? []) onUpdate?.(update);
          return result.value;
        } finally {
          if (hostToken) extension.client.releaseHostSession(hostToken);
        }
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

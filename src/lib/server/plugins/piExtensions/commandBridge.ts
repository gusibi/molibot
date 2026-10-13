import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PiExtensionToolOptions } from "./toolBridge.js";
import { getPiExtensionRunHost } from "./runHost.js";
import { bindPiExtensionHostSession } from "./toolBridge.js";
import { momError, momWarn } from "$lib/server/agent/common/log.js";
import { createHeadlessExtensionContext } from "$lib/server/plugins/piExtensions/context.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";

export interface PiExtensionCommandResult {
  handled: boolean;
  /** Text the extension asked to show the user, if any. */
  output?: string;
  error?: string;
}

export interface PiExtensionCommandOptions {
  /** Active extensions for this bot, in load order. */
  extensions: LoadedPiExtension[];
  cwd: string;
  signal?: AbortSignal;
  runId?: string;
  sessionId?: string;
}

/**
 * Run a channel slash command against installed pi extensions.
 *
 * Called only after every built-in command missed, so an extension can never
 * shadow `/stop`, `/help` or any other core command. First registration wins,
 * matching pi.
 *
 * pi command handlers talk to the user through `ctx.ui.notify` and
 * `api.sendMessage`; on a channel there is no dialog surface, so notifications
 * are collected and returned as the command's reply text.
 */
export async function runPiExtensionCommand(
  commandName: string,
  args: string,
  options: PiExtensionCommandOptions
): Promise<PiExtensionCommandResult> {
  const name = commandName.replace(/^\//, "").trim();
  if (!name) return { handled: false };

  for (const extension of options.extensions) {
    const command = extension.extension?.commands.get(name)
      ?? extension.commands?.find((candidate) => candidate.name === name);
    if (!command) continue;

    const lines: string[] = [];
    const ctx = createHeadlessExtensionContext({
      cwd: options.cwd,
      signal: options.signal,
      extensionId: extension.id
    });
    // Capture notifications instead of only logging them: on a channel this is
    // the command's visible output.
    ctx.ui.notify = (message: string, type: "info" | "warning" | "error" = "info") => {
      lines.push(type === "info" ? message : `[${type}] ${message}`);
    };

    try {
      if (extension.client) {
        const host = getPiExtensionRunHost(options.runId);
        const runtime = await host?.runtime?.();
        if (runtime && options.sessionId && runtime.sessionId !== options.sessionId) throw new Error("The extension command belongs to a different Session.");
        const hostToken = host ? bindPiExtensionHostSession(extension.client, host, options.signal, `command:${name}`) : undefined;
        try {
        const result = await extension.client.request("invokeCommand", {
          extensionId: extension.id,
          command: name,
          args,
          cwd: options.cwd,
          runtime, tools: host?.toolCatalog?.(), hostToken
        }, options.signal);
        for (const notification of result.notifications ?? []) {
          ctx.ui.notify(notification.message, notification.type);
        }
        } finally { if (hostToken) extension.client.releaseHostSession(hostToken); }
      } else {
        await (command as any).handler(args, ctx as any);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      momError("plugins", "pi_extension_command_failed", {
        extensionId: extension.id,
        command: name,
        error: reason
      });
      return { handled: true, error: reason };
    }

    if (lines.length === 0) {
      momWarn("plugins", "pi_extension_command_silent", { extensionId: extension.id, command: name });
    }

    return { handled: true, output: lines.join("\n") || undefined };
  }

  return { handled: false };
}

/** Command names the active extensions contribute, for `/help`. */
export function listPiExtensionCommands(
  extensions: LoadedPiExtension[]
): Array<{ name: string; description?: string; extensionId: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; description?: string; extensionId: string }> = [];
  for (const extension of extensions) {
    const commands = extension.extension
      ? [...extension.extension.commands.entries()].map(([name, command]) => ({ name, description: command.description }))
      : extension.commands ?? [];
    for (const command of commands) {
      const { name } = command;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, description: command.description, extensionId: extension.id });
    }
  }
  return out;
}


export function piExtensionCommandToolName(extensionId: string, command: string): string {
  return `piCommand__${extensionId}__${command}`;
}

/** Commands reuse the production process and the same invocation capabilities as extension tools. */
export function createPiExtensionCommandTools(extensions: LoadedPiExtension[], options: PiExtensionToolOptions): AgentTool<any>[] {
  return extensions.flatMap(extension => (extension.commands ?? []).map(command => ({
    name: piExtensionCommandToolName(extension.id, command.name), label: `/${command.name}`, description: command.description ?? "Installed extension command",
    parameters: Type.Object({ args: Type.String() }),
    async execute(id: string, args: any, signal?: AbortSignal) {
      if (!extension.client) throw new Error("An installed command requires the isolated extension host.");
      const runtime = await options.runtime?.();
      const hostToken = bindPiExtensionHostSession(extension.client, options, signal, id);
      try {
        const result = await extension.client.request("invokeCommand", { extensionId: extension.id, command: command.name, args: args.args, cwd: options.cwd, runtime, tools: options.toolCatalog?.(), hostToken }, signal);
        const text = (result.notifications ?? []).map((item: { message: string; type: string }) => item.type === "info" ? item.message : `[${item.type}] ${item.message}`).join("\n");
        return { content: [{ type: "text" as const, text: text || "Extension command completed." }], details: {} };
      } finally { if (hostToken) extension.client.releaseHostSession(hostToken); }
    }
  })));
}

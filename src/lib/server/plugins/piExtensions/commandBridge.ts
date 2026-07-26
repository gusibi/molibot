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
    const command = extension.extension.commands.get(name);
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
      await command.handler(args, ctx as any);
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
    for (const [name, command] of extension.extension.commands) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, description: command.description, extensionId: extension.id });
    }
  }
  return out;
}

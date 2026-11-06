import { Type } from "@sinclair/typebox";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { piExtensionTerminalHost } from "$lib/server/plugins/piExtensions/nativeTerminal.js";
import type { PiExtensionToolOptions } from "$lib/server/plugins/piExtensions/toolBridge.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

const schema = Type.Object({ prompt: Type.String({ minLength: 1, description: "Task or /extension-command for the native Pi session. Standard dialogs appear in the current Molibot chat; custom UI uses the Pi terminal." }) });

export function createPiExtensionRunTool(options: PiExtensionToolOptions & { sessionId: string; runId?: string; botId?: string; agentId?: string; getSettings: () => RuntimeSettings; imageOutputDir: string; onFailure?: (message: string) => void }): AgentTool<typeof schema> {
  const catalog = getPiExtensionHost().getNativeExtensions(options.getSettings(), options.botId)
    .map(extension => `${extension.name} (${extension.id})${extension.description ? `: ${extension.description}` : ""}; commands: ${extension.commandNames.map(name => `/${name}`).join(", ") || "none"}`).join("\n");
  return {
    name: "piExtensionRun", label: "Pi extension session",
    description: "Run installed Pi extensions in the official interactive Pi runtime. Use this entry whenever the task requests one of the extensions below, including its dynamically registered tools. Pass the user's goal and constraints as prompt. Do not replace it with shell scripts or a separate MCP client. Uses this run's model budget and controlled host tools. Desktop approval dialogs must be answered by the human. Never replay an interrupted native task without checking effects.\nInstalled extensions:\n" + catalog,
    parameters: schema,
    async execute(callId, args, signal, onUpdate) {
      const delivered: string[] = [];
      try {
        if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("Native Pi requires a non-empty task or extension command.");
        if (!options.runId) throw new Error("Native Pi requires an active host run.");
        const extensions = getPiExtensionHost().getNativeExtensions(options.getSettings(), options.botId);
        if (!extensions.length) throw new Error("No enabled Pi extensions are available. Install and enable the extension first.");
        const flags: Record<string, boolean | string> = {};
        for (const extension of extensions) for (const [name, value] of Object.entries(options.getSettings().plugins.piExtensions.entries[extension.id]?.flags ?? {})) {
          if (extension.flagNames.includes(name) && (typeof value === "boolean" || typeof value === "string")) flags[name] = value;
        }
        const result = await piExtensionTerminalHost.run({ sessionId: options.sessionId, agentId: options.agentId, runId: options.runId, callId, prompt: args.prompt, extensions, flags, options, signal,
          onStarted: (terminal) => onUpdate?.({ content: [{ type: "text", text: "Native Pi session started. Answer extension dialogs in this chat; custom UI is available through the Pi terminal." }], details: { piTerminalId: terminal.id } }) });
        if (result.suspension) return { ...result.suspension, content: [...result.suspension.content, { type: "text" as const, text: result.text }], details: { ...(result.suspension.details as object ?? {}), piTerminalId: result.terminalId } };
        for (const image of result.images ?? []) {
          signal?.throwIfAborted();
          mkdirSync(options.imageOutputDir, { recursive: true });
          const path = join(options.imageOutputDir, `pi-${randomUUID()}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png"}`);
          writeFileSync(path, Buffer.from(image.data, "base64"), { mode: 0o600, flag: "wx" });
          const outcome = await options.executeTool!("attach", { label: "Pi extension image", path }, signal, `${callId}:image:${delivered.length}`);
          if (outcome.result.terminate) return outcome.result;
          if (outcome.isError) throw new Error("Pi image attachment failed. Do not rerun the native task; use the saved artifacts to finish delivery.");
          delivered.push(path);
        }
        return { content: [{ type: "text", text: (result.text || "Native Pi command completed.") + (result.sharingStatus === "released" ? "\nThis task’s LCU application sharing was stopped and verified." : "") + (delivered.length ? `\nDelivered ${delivered.length} image attachment(s).` : "") }], details: { piTerminalId: result.terminalId, sharingStatus: result.sharingStatus, images: delivered } };
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        options.onFailure?.(message);
        return { content: [{ type: "text", text: `Pi extension failed: ${message}
${delivered.length ? `Already delivered ${delivered.length} image(s). Preserve these receipts; do not resend them.\n` : ""}Stop this task; do not replace it with scripts or answer approvals automatically.` }], error: message, isError: true, terminate: true, details: { piExtensionFailure: true, deliveredImages: delivered } };
      }
    }
  };
}

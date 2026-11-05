import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { piExtensionTerminalHost } from "$lib/server/plugins/piExtensions/nativeTerminal.js";
import type { PiExtensionToolOptions } from "$lib/server/plugins/piExtensions/toolBridge.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

const schema = Type.Object({ prompt: Type.String({ minLength: 1, description: "Task or /extension-command for the native Pi session. Its interactive terminal is shown in Molibot." }) });

export function createPiExtensionRunTool(options: PiExtensionToolOptions & { sessionId: string; runId?: string; botId?: string; getSettings: () => RuntimeSettings }): AgentTool<typeof schema> {
  return {
    name: "piExtensionRun", label: "Pi extension session",
    description: "Run installed Pi extensions in the official interactive Pi runtime. Use for native dialogs, custom terminal UI, shortcuts, dynamic tools or extension commands that need the full Pi session. Uses this run's model budget and controlled host tools. Native code is owner-trusted; desktop terminal input is human interaction. Never replay an interrupted native task without checking effects.",
    parameters: schema,
    async execute(callId, args, signal, onUpdate) {
      if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("Native Pi requires a non-empty task or extension command.");
      if (!options.runId) throw new Error("Native Pi requires an active host run.");
      const extensions = getPiExtensionHost().getNativeExtensions(options.getSettings(), options.botId);
      if (!extensions.length) throw new Error("No enabled Pi extensions are available. Install and enable the extension first.");
      const flags: Record<string, boolean | string> = {};
      for (const extension of extensions) for (const [name, value] of Object.entries(options.getSettings().plugins.piExtensions.entries[extension.id]?.flags ?? {})) {
        if (extension.flagNames.includes(name) && (typeof value === "boolean" || typeof value === "string")) flags[name] = value;
      }
      const result = await piExtensionTerminalHost.run({ sessionId: options.sessionId, runId: options.runId, callId, prompt: args.prompt, extensions, flags, options, signal,
        onStarted: (terminal) => onUpdate?.({ content: [{ type: "text", text: "Native Pi terminal started. Open the Pi terminal panel to answer extension interactions." }], details: { piTerminalId: terminal.id } }) });
      if (result.suspension) return { ...result.suspension, content: [...result.suspension.content, { type: "text" as const, text: result.text }], details: { ...(result.suspension.details as object ?? {}), piTerminalId: result.terminalId } };
      return { content: [{ type: "text", text: result.text || "Native Pi command completed." }], details: { piTerminalId: result.terminalId } };
    }
  };
}

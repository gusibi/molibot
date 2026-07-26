import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { installPiExtension, uninstallPiExtension } from "$lib/server/plugins/piExtensions/install.js";
import { describeResolvedSpec, resolveExtensionInput } from "$lib/server/plugins/piExtensions/specResolver.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const extensionManageSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("inspect"),
    Type.Literal("install"),
    Type.Literal("uninstall"),
    Type.Literal("enable"),
    Type.Literal("disable")
  ], { description: "What to do. `inspect` resolves a link without installing anything." }),
  target: Type.Optional(Type.String({
    description: "For install/inspect: an npm package name or a link (npm page, repository, or monorepo subdirectory). For uninstall/enable/disable: the installed extension id."
  }))
});

function formatCatalog(settings: RuntimeSettings): string {
  const rows = getPiExtensionHost().listCatalog(settings);
  if (rows.length === 0) return "No pi extensions are installed.";

  const lines = [`Installed pi extensions: ${rows.length}`, ""];
  for (const row of rows) {
    lines.push(`- ${row.id} (v${row.version})${row.enabled ? "" : " [disabled]"}`);
    if (row.description) lines.push(`  ${row.description}`);
    if (row.toolNames.length > 0) lines.push(`  tools: ${row.toolNames.join(", ")}`);
    if (row.eventNames.length > 0) lines.push(`  events: ${row.eventNames.join(", ")}`);
    if (row.commandNames.length > 0) lines.push(`  commands: ${row.commandNames.map((n) => `/${n}`).join(", ")}`);
    if (row.disabledBots.length > 0) lines.push(`  disabled for bots: ${row.disabledBots.join(", ")}`);
    if (row.unsupported.length > 0) lines.push(`  unsupported capabilities used: ${row.unsupported.join(", ")}`);
    if (row.error) lines.push(`  problem: ${row.error}`);
  }
  return lines.join("\n");
}

/**
 * Owner-facing management of third-party pi extensions from a chat.
 *
 * Installing runs npm/git and then executes the extension's factory, so this
 * tool is classified `critical` in `toolClassification.ts` and reaches the
 * approval broker before anything is downloaded. That gate is deliberate even
 * though the owner controls their own data directory: "install this plugin" is a
 * sentence that can appear in a page or document the agent read, and only the
 * owner can confirm they actually asked for it.
 */
export function createExtensionManageTool(options: {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}): AgentTool<typeof extensionManageSchema> {
  const entriesOf = (settings: RuntimeSettings) => settings.plugins.piExtensions.entries ?? {};

  const setEnabled = (id: string, enabled: boolean): string => {
    const settings = options.getSettings();
    const entries = entriesOf(settings);
    const existing = entries[id];
    if (!existing && !getPiExtensionHost().listCatalog(settings).some((row) => row.id === id)) {
      return `No installed extension with id "${id}". Use action "list" to see what is installed.`;
    }
    options.updateSettings({
      plugins: {
        ...settings.plugins,
        piExtensions: {
          enabled: settings.plugins.piExtensions.enabled,
          entries: {
            ...entries,
            [id]: {
              enabled,
              disabledBots: existing?.disabledBots ?? [],
              ...(existing?.flags ? { flags: existing.flags } : {})
            }
          }
        }
      }
    });
    return `Extension "${id}" is now ${enabled ? "enabled" : "disabled"}.`;
  };

  return {
    name: "extensionManage",
    label: "extensionManage",
    description: [
      "Manage third-party pi extensions: list what is installed, inspect a link before installing,",
      "install from an npm package name or a repository link, uninstall, or enable/disable one.",
      "Installing downloads and executes third-party code, so it requires owner approval."
    ].join(" "),
    parameters: extensionManageSchema,
    execute: async (_toolCallId, params) => {
      const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
      const target = String(params.target ?? "").trim();
      const host = getPiExtensionHost();

      if (params.action === "list") {
        await host.load();
        return text(formatCatalog(options.getSettings()));
      }

      if (!target) return text(`Action "${params.action}" needs a target.`);

      if (params.action === "inspect") {
        const resolution = resolveExtensionInput(target);
        if (!resolution.ok) {
          return text([`Cannot install from "${target}": ${resolution.error}`, resolution.hint].filter(Boolean).join("\n"));
        }
        return text([
          `"${target}" resolves to:`,
          `  ${describeResolvedSpec(resolution.resolved)}`,
          `  install directory: ${resolution.resolved.id}`,
          "",
          "Nothing was installed. Use action \"install\" to proceed (requires approval)."
        ].join("\n"));
      }

      if (params.action === "install") {
        const resolution = resolveExtensionInput(target);
        if (!resolution.ok) {
          return text([`Cannot install from "${target}": ${resolution.error}`, resolution.hint].filter(Boolean).join("\n"));
        }
        const { source, spec, subdir, ref, id } = resolution.resolved;
        const result = await installPiExtension({ source, spec, subdir, ref, id });
        if (!result.ok) {
          return text([`Install failed: ${result.error}`, result.log ? `\n${result.log}` : ""].join(""));
        }

        // Newly installed extensions start enabled, then load so their tools and
        // commands are usable without a restart.
        const settings = options.getSettings();
        options.updateSettings({
          plugins: {
            ...settings.plugins,
            piExtensions: {
              enabled: settings.plugins.piExtensions.enabled,
              entries: { ...entriesOf(settings), [result.id!]: { enabled: true, disabledBots: [] } }
            }
          }
        });
        await host.reload();

        const row = host.listCatalog(options.getSettings()).find((entry) => entry.id === result.id);
        const lines = [`Installed "${result.id}" from ${describeResolvedSpec(resolution.resolved)}.`];
        if (row) {
          if (row.toolNames.length > 0) lines.push(`Tools: ${row.toolNames.join(", ")}`);
          if (row.eventNames.length > 0) lines.push(`Events: ${row.eventNames.join(", ")}`);
          if (row.commandNames.length > 0) lines.push(`Commands: ${row.commandNames.map((n) => `/${n}`).join(", ")}`);
          if (row.unsupported.length > 0) {
            lines.push(`Note: this extension uses capabilities Molibot does not support (${row.unsupported.join(", ")}); those parts will not work.`);
          }
          if (row.error) lines.push(`Problem: ${row.error}`);
        }
        lines.push("New tools become available on the next turn.");
        return text(lines.join("\n"));
      }

      if (params.action === "uninstall") {
        const result = uninstallPiExtension(target);
        if (!result.ok) return text(`Uninstall failed: ${result.error}`);
        const settings = options.getSettings();
        const entries = { ...entriesOf(settings) };
        delete entries[target];
        options.updateSettings({
          plugins: {
            ...settings.plugins,
            piExtensions: { enabled: settings.plugins.piExtensions.enabled, entries }
          }
        });
        await host.reload();
        return text(`Uninstalled "${target}".`);
      }

      return text(setEnabled(target, params.action === "enable"));
    }
  };
}

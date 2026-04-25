import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../../settings/index.js";

const loadMcpSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("load"),
    Type.Literal("unload"),
    Type.Literal("clear")
  ]),
  serverId: Type.Optional(Type.String())
});

function formatServerList(
  settings: RuntimeSettings,
  selectedIds: Set<string>
): string {
  const rows = settings.mcpServers ?? [];
  if (rows.length === 0) {
    return "No MCP servers configured in settings.";
  }
  const lines: string[] = [
    `Configured MCP servers: ${rows.length}`,
    ""
  ];
  for (const row of rows) {
    const selected = selectedIds.has(row.id) ? " (loaded)" : "";
    const enabled = row.enabled ? "enabled" : "disabled";
    lines.push(`- ${row.id}${selected}`);
    lines.push(`  - status: ${enabled}`);
    lines.push(`  - transport: ${row.transport}`);
  }
  return lines.join("\n");
}

export function createLoadMcpTool(options: {
  getSettings: () => RuntimeSettings;
  getSelectedServerIds: () => Set<string>;
  setSelectedServerIds: (next: Set<string>) => void;
  refreshLoadedMcpTools: () => Promise<{ serverCount: number; toolCount: number }>;
}): AgentTool<typeof loadMcpSchema> {
  return {
    name: "loadMcp",
    label: "loadMcp",
    description: "List/load/unload MCP servers for this chat session. Use this when you need a specific MCP server. If server is missing or disabled, this tool throws a clear error.",
    parameters: loadMcpSchema,
    execute: async (_toolCallId, params) => {
      const settings = options.getSettings();
      const action = String(params.action ?? "list").trim().toLowerCase();

      if (action === "list") {
        return {
          content: [{ type: "text", text: formatServerList(settings, options.getSelectedServerIds()) }],
          details: undefined
        };
      }

      if (action === "clear") {
        options.setSelectedServerIds(new Set<string>());
        const refreshed = await options.refreshLoadedMcpTools();
        return {
          content: [{
            type: "text",
            text: `Cleared loaded MCP servers.\nLoaded servers: ${refreshed.serverCount}\nLoaded MCP tools: ${refreshed.toolCount}`
          }],
          details: {
            action,
            loadedServerCount: refreshed.serverCount,
            loadedToolCount: refreshed.toolCount
          }
        };
      }

      const serverId = String(params.serverId ?? "").trim();
      if (!serverId) {
        throw new Error("serverId is required for action=load/unload");
      }

      const configured = (settings.mcpServers ?? []).find((server) => server.id === serverId);
      if (!configured) {
        throw new Error(`MCP server not found: ${serverId}`);
      }
      if (!configured.enabled) {
        throw new Error(`MCP server is disabled: ${serverId}. Enable it in /settings/mcp first.`);
      }

      const next = new Set(options.getSelectedServerIds());
      if (action === "load") {
        next.add(serverId);
      } else if (action === "unload") {
        next.delete(serverId);
      } else {
        throw new Error(`Unsupported action: ${action}`);
      }

      options.setSelectedServerIds(next);
      const refreshed = await options.refreshLoadedMcpTools();
      return {
        content: [{
          type: "text",
          text: `${action === "load" ? "Loaded" : "Unloaded"} MCP server: ${serverId}\nLoaded servers: ${refreshed.serverCount}\nLoaded MCP tools: ${refreshed.toolCount}`
        }],
        details: {
          action,
          serverId,
          loadedServerCount: refreshed.serverCount,
          loadedToolCount: refreshed.toolCount
        }
      };
    }
  };
}

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const mcpInvokeSchema = Type.Object({
  action: Type.Union([
    Type.Literal("listTools"),
    Type.Literal("call")
  ]),
  serverId: Type.Optional(Type.String({
    description: "Loaded MCP server id, for example tdx."
  })),
  toolName: Type.Optional(Type.String({
    description: "MCP tool name. Use either the full local name like mcp__tdx__query, or the remote tool name with serverId."
  })),
  arguments: Type.Optional(Type.Unsafe<Record<string, unknown>>({
    type: "object",
    additionalProperties: true,
    description: "Arguments to pass to the selected MCP tool."
  }))
});

function normalizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function parseMcpToolName(name: string): { serverId?: string; remoteToolName?: string } {
  if (!name.startsWith("mcp__")) return {};
  const [, serverId, ...rest] = name.split("__");
  return {
    serverId,
    remoteToolName: rest.join("__") || undefined
  };
}

function describeTool(tool: AgentTool<any>): string {
  const parsed = parseMcpToolName(tool.name);
  const remote = parsed.remoteToolName ? ` remote=${parsed.remoteToolName}` : "";
  const server = parsed.serverId ? ` server=${parsed.serverId}` : "";
  return [
    `- ${tool.name}${server}${remote}`,
    `  ${tool.description || tool.label || "MCP tool"}`,
    `  parameters: ${JSON.stringify(tool.parameters ?? { type: "object", additionalProperties: true })}`
  ].join("\n");
}

function findMcpTool(
  tools: AgentTool<any>[],
  serverId: string,
  toolName: string
): AgentTool<any> | null {
  const exact = tools.find((tool) => tool.name === toolName);
  if (exact) return exact;

  const normalizedServer = normalizeSegment(serverId);
  const normalizedTool = normalizeSegment(toolName);
  const matches = tools.filter((tool) => {
    const parsed = parseMcpToolName(tool.name);
    if (!parsed.serverId || parsed.serverId !== normalizedServer) return false;
    return parsed.remoteToolName === normalizedTool || tool.name === `mcp__${normalizedServer}__${normalizedTool}`;
  });
  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

export function createMcpInvokeTool(options: {
  getLoadedMcpTools: () => AgentTool<any>[];
}): AgentTool<typeof mcpInvokeSchema> {
  return {
    name: "mcpInvoke",
    label: "mcpInvoke",
    description: [
      "List and invoke tools from MCP servers already loaded with loadMcp.",
      "Use action=listTools after loadMcp(action=load) to see available MCP tool names.",
      "Use action=call with serverId, toolName, and arguments to call a loaded MCP tool."
    ].join("\n"),
    parameters: mcpInvokeSchema,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const action = String(params.action ?? "listTools").trim();
      const tools = options.getLoadedMcpTools().filter((tool) => tool.name.startsWith("mcp__"));

      if (action === "listTools") {
        const lines = tools.length > 0
          ? [
            `Loaded MCP tools: ${tools.length}`,
            "",
            ...tools.map(describeTool),
            "",
            "Call one with mcpInvoke(action=\"call\", serverId=\"...\", toolName=\"...\", arguments={...})."
          ]
          : [
            "No MCP tools are currently loaded.",
            "Call loadMcp(action=\"load\", serverId=\"...\") first."
          ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { action, loadedToolCount: tools.length }
        };
      }

      if (action !== "call") {
        throw new Error(`Unsupported mcpInvoke action: ${action}`);
      }

      const serverId = String(params.serverId ?? "").trim();
      const toolName = String(params.toolName ?? "").trim();
      if (!toolName) {
        throw new Error("toolName is required for mcpInvoke action=call.");
      }
      if (!serverId && !toolName.startsWith("mcp__")) {
        throw new Error("serverId is required when toolName is not a full mcp__... tool name.");
      }

      const tool = findMcpTool(tools, serverId, toolName);
      if (!tool) {
        const available = tools.map((item) => item.name).join(", ") || "(none)";
        throw new Error(`Loaded MCP tool not found: ${toolName}. Available MCP tools: ${available}`);
      }

      const input = params.arguments && typeof params.arguments === "object"
        ? params.arguments as Record<string, unknown>
        : {};
      const result = await tool.execute(`${toolCallId}:${tool.name}`, input, signal);
      return {
        content: result.content,
        details: {
          action,
          invokedToolName: tool.name,
          ...(result.details && typeof result.details === "object" ? result.details : {})
        }
      };
    }
  };
}

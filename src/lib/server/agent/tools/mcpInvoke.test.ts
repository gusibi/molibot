import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@sinclair/typebox";
import { createMcpInvokeTool } from "$lib/server/agent/tools/mcpInvoke.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";

function createFakeMcpTool(calls: Array<Record<string, unknown>>): AgentTool<any> {
  return {
    name: "mcp__tdx__stock_volume_rank",
    label: "mcp:tdx/stock_volume_rank",
    description: "[MCP:tdx] Query top stocks by volume.",
    parameters: Type.Object({
      date: Type.String(),
      limit: Type.Optional(Type.Number())
    }),
    execute: async (_toolCallId, params) => {
      calls.push(params as Record<string, unknown>);
      return {
        content: [{ type: "text", text: "600000.SH volume=123" }],
        details: {
          serverId: "tdx",
          remoteToolName: "stock_volume_rank"
        }
      };
    }
  };
}

test("mcpInvoke lists loaded MCP tools", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tool = createMcpInvokeTool({
    getLoadedMcpTools: () => [createFakeMcpTool(calls)]
  });

  const result = await tool.execute("call-1", { action: "listTools" });
  const text = result.content.map((item: any) => String(item.text ?? "")).join("\n");

  assert.match(text, /Loaded MCP tools: 1/);
  assert.match(text, /mcp__tdx__stock_volume_rank/);
  assert.match(text, /mcpInvoke\(action="call"/);
});

test("mcpInvoke calls a loaded MCP tool by server and remote name", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tool = createMcpInvokeTool({
    getLoadedMcpTools: () => [createFakeMcpTool(calls)]
  });

  const result = await tool.execute("call-1", {
    action: "call",
    serverId: "tdx",
    toolName: "stock_volume_rank",
    arguments: {
      date: "2026-06-19",
      limit: 5
    }
  });
  const text = result.content.map((item: any) => String(item.text ?? "")).join("\n");

  assert.deepEqual(calls, [{ date: "2026-06-19", limit: 5 }]);
  assert.match(text, /600000\.SH/);
  assert.equal(result.details?.invokedToolName, "mcp__tdx__stock_volume_rank");
  assert.equal(result.details?.serverId, "tdx");
});

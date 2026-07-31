import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { McpToolRegistry, redactMcpError } from "./mcp.js";

const fixtureCode = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = new McpServer({ name: 'molibot-mcp-lifecycle-fixture', version: '1.0.0' });
server.registerTool('ping', { description: 'ping' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
server.registerTool('die', { description: 'exit after responding' }, async () => {
  setTimeout(() => process.exit(0), 20);
  return { content: [{ type: 'text', text: 'bye' }] };
});
await server.connect(new StdioServerTransport());
`;

function server(id: string): McpServerConfig {
  return {
    id,
    name: id,
    enabled: true,
    transport: "stdio",
    stdio: {
      command: process.execPath,
      args: ["--input-type=module", "-e", fixtureCode],
      cwd: "",
      env: {}
    },
    http: { url: "", headers: {} },
    toolNamePrefix: id
  };
}

function tool(tools: AgentTool<any>[], suffix: string): AgentTool<any> {
  const found = tools.find((item) => item.name.endsWith(`__${suffix}`));
  assert.ok(found, `Expected MCP tool ending in __${suffix}`);
  return found;
}

async function invoke(item: AgentTool<any>): Promise<string> {
  const result = await item.execute("fixture-call", {}, new AbortController().signal);
  return result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
}

test("reconnects an unchanged MCP config after its stdio process exits", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const config = server("recover");

  const first = await registry.getTools([config], { workspaceDir: process.cwd() });
  await invoke(tool(first, "die"));
  await new Promise((resolve) => setTimeout(resolve, 120));

  const second = await registry.getTools([config], { workspaceDir: process.cwd() });
  assert.notEqual(tool(first, "ping"), tool(second, "ping"));
  assert.equal(await invoke(tool(second, "ping")), "pong");
  assert.equal(registry.getStatuses([config], process.cwd())[0]?.state, "connected");
});

test("keeps connections isolated while returning only the caller's scoped tools", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const alpha = server("alpha");
  const beta = server("beta");

  const alphaTools = await registry.getTools([alpha], { workspaceDir: process.cwd() });
  const betaTools = await registry.getTools([beta], { workspaceDir: process.cwd() });

  assert.equal(alphaTools.every((item) => item.name.startsWith("mcp__alpha__")), true);
  assert.equal(betaTools.every((item) => item.name.startsWith("mcp__beta__")), true);
  assert.equal(await invoke(tool(alphaTools, "ping")), "pong");
  assert.equal(await invoke(tool(betaTools, "ping")), "pong");
});

test("disable closes a connection and re-enable creates a fresh client", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const enabled = server("toggle");
  const first = await registry.getTools([enabled], { workspaceDir: process.cwd() });

  await registry.reconcile([{ ...enabled, enabled: false }], {
    workspaceDir: process.cwd(),
    connectEnabled: true
  });
  assert.equal(registry.getStatuses([{ ...enabled, enabled: false }], process.cwd())[0]?.state, "disabled");

  await registry.reconcile([enabled], { workspaceDir: process.cwd(), connectEnabled: true });
  const second = await registry.getTools([enabled], { workspaceDir: process.cwd() });
  assert.notEqual(tool(first, "ping"), tool(second, "ping"));
  assert.equal(await invoke(tool(second, "ping")), "pong");
});

test("reports connection errors and force reconnect attempts a fresh connection", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const missing = {
    ...server("missing"),
    stdio: { command: "molibot-missing-mcp-command", args: [], cwd: "", env: {} }
  };

  await registry.getTools([missing], { workspaceDir: process.cwd() });
  const failed = registry.getStatuses([missing], process.cwd())[0];
  assert.equal(failed?.state, "error");
  assert.match(failed?.lastError ?? "", /ENOENT|not found|spawn/i);
  const firstAttempt = failed?.lastAttemptAt;

  await new Promise((resolve) => setTimeout(resolve, 5));
  await registry.reconnect(missing, { workspaceDir: process.cwd() });
  const retried = registry.getStatuses([missing], process.cwd())[0];
  assert.equal(retried?.state, "error");
  assert.notEqual(retried?.lastAttemptAt, firstAttempt);
});

test("redacts MCP credentials and URL query values from live errors", () => {
  const config = {
    ...server("safe-error"),
    stdio: { command: "node", args: [], cwd: "", env: { TOKEN: "stdio-secret" } },
    http: {
      url: "http://user:password@127.0.0.1:9123/mcp?token=query-secret",
      headers: { Authorization: "Bearer header-secret" }
    }
  };
  const safe = redactMcpError(
    `Failed http://user:password@127.0.0.1:9123/mcp?token=query-secret Bearer header-secret stdio-secret`,
    config
  );
  assert.equal(safe.includes("password"), false);
  assert.equal(safe.includes("query-secret"), false);
  assert.equal(safe.includes("header-secret"), false);
  assert.equal(safe.includes("stdio-secret"), false);
  assert.match(safe, /REDACTED|redacted/);
});

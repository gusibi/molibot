import assert from "node:assert/strict";
import test from "node:test";
import type { McpServerConfig, RuntimeSettings } from "$lib/server/settings/schema";
import { buildDesktopMcpItem, buildDesktopMcpSummary, deleteDesktopMcpServer, saveDesktopMcpServer } from "./desktopMcp";

function stdioServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "fs",
    name: "Filesystem",
    enabled: true,
    transport: "stdio",
    stdio: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "--token=SECRET-ARG"],
      env: { API_TOKEN: "sk-secret-env-value", HOME: "/Users/secret" },
      cwd: "/Users/secret/projects"
    },
    http: { url: "", headers: {} },
    toolNamePrefix: "fs_",
    ...overrides
  } as McpServerConfig;
}

function httpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "remote",
    name: "Remote",
    enabled: true,
    transport: "http",
    stdio: { command: "", args: [], env: {}, cwd: "" },
    http: {
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer sk-secret-header-token" }
    },
    toolNamePrefix: "",
    ...overrides
  } as McpServerConfig;
}

test("buildDesktopMcpItem keeps command but drops env/cwd/args values to counts", () => {
  const item = buildDesktopMcpItem(stdioServer());

  assert.equal(item.transport, "stdio");
  assert.equal(item.command, "npx");
  assert.equal(item.argCount, 3);
  assert.equal(item.envKeyCount, 2);
  assert.deepEqual(item.envKeys, ["API_TOKEN", "HOME"]);
  assert.equal(item.cwdConfigured, true);
  assert.equal(item.toolNamePrefix, "fs_");
  assert.equal(item.url, "");
  assert.equal(item.headerCount, 0);

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("sk-secret-env-value"), false);
  assert.equal(serialized.includes("SECRET-ARG"), false);
  assert.equal(serialized.includes("/Users/secret"), false);
});

test("buildDesktopMcpItem keeps url but drops http header values to a count", () => {
  const item = buildDesktopMcpItem(httpServer());

  assert.equal(item.transport, "http");
  assert.equal(item.url, "https://mcp.example.com/sse");
  assert.equal(item.headerCount, 1);
  assert.deepEqual(item.headerKeys, ["Authorization"]);
  assert.equal(item.command, "");
  assert.equal(item.envKeyCount, 0);
  assert.equal(JSON.stringify(item).includes("sk-secret-header-token"), false);
});

test("saveDesktopMcpServer preserves hidden values unless explicitly replaced or cleared", () => {
  const settings = { mcpServers: [stdioServer()] } as RuntimeSettings;
  const saved = saveDesktopMcpServer(settings, {
    previousId: "fs",
    id: "fs",
    name: "Filesystem 2",
    enabled: false,
    transport: "stdio",
    toolNamePrefix: "local_",
    command: "pnpm",
    url: "",
    envValues: { API_TOKEN: "replacement", NEW_KEY: "new-value" },
    clearEnvKeys: ["HOME"]
  });
  assert.deepEqual(saved[0].stdio.args, stdioServer().stdio.args);
  assert.equal(saved[0].stdio.cwd, "/Users/secret/projects");
  assert.deepEqual(saved[0].stdio.env, { API_TOKEN: "replacement", NEW_KEY: "new-value" });
  assert.equal(saved[0].stdio.command, "pnpm");
});

test("saveDesktopMcpServer creates HTTP servers and delete removes exactly one", () => {
  const created = saveDesktopMcpServer({ mcpServers: [] } as unknown as RuntimeSettings, {
    id: "remote",
    name: "Remote",
    enabled: true,
    transport: "http",
    toolNamePrefix: "",
    command: "",
    url: "https://mcp.example.com",
    headerValues: { Authorization: "Bearer secret" }
  });
  assert.equal(created[0].http.headers.Authorization, "Bearer secret");
  assert.deepEqual(deleteDesktopMcpServer({ mcpServers: created } as RuntimeSettings, "remote"), []);
  assert.throws(() => deleteDesktopMcpServer({ mcpServers: created } as RuntimeSettings, "missing"), /Unknown MCP server/);
});

test("buildDesktopMcpSummary counts total/enabled and by transport without leaking secrets", () => {
  const summary = buildDesktopMcpSummary({
    mcpServers: [stdioServer(), httpServer({ enabled: false }), stdioServer({ id: "fs2" })]
  } as RuntimeSettings);

  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.enabled, 2);
  assert.equal(summary.counts.stdio, 2);
  assert.equal(summary.counts.http, 1);
  assert.equal(JSON.stringify(summary).includes("sk-secret"), false);
});

test("buildDesktopMcpSummary keeps configured enablement separate from live connection state", () => {
  const summary = buildDesktopMcpSummary(
    { mcpServers: [stdioServer(), httpServer({ enabled: false })] } as RuntimeSettings,
    [{
      serverId: "fs",
      state: "error",
      toolCount: 0,
      lastError: "Not connected",
      lastAttemptAt: "2026-07-31T12:00:00.000Z"
    }]
  );

  assert.equal(summary.items[0].enabled, true);
  assert.equal(summary.items[0].connectionState, "error");
  assert.equal(summary.items[0].lastError, "Not connected");
  assert.equal(summary.items[1].enabled, false);
  assert.equal(summary.items[1].connectionState, "disabled");
});

test("buildDesktopMcpSummary includes the managed OpenConnector MCP server", () => {
  const summary = buildDesktopMcpSummary({
    mcpServers: [],
    openConnector: {
      enabled: true,
      baseUrl: "https://opc.example.com",
      consoleUrl: "https://opc.example.com/providers",
      runtimeToken: "oct-secret"
    }
  } as RuntimeSettings);

  assert.equal(summary.counts.total, 1);
  assert.equal(summary.items[0]?.id, "open-connector");
  assert.equal(summary.items[0]?.managed, true);
  assert.equal(summary.items[0]?.url, "https://opc.example.com/mcp");
  assert.equal(JSON.stringify(summary).includes("oct-secret"), false);
});

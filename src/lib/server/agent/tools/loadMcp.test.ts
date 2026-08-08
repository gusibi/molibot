import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { createLoadMcpTool } from "./loadMcp.js";

const settings = {
  mcpServers: [{
    id: "local",
    name: "Local",
    enabled: true,
    transport: "http",
    stdio: { command: "", args: [], env: {}, cwd: "" },
    http: { url: "http://127.0.0.1:9123/mcp", headers: {} },
    toolNamePrefix: "local"
  }]
} as unknown as RuntimeSettings;

test("loadMcp reports a failed connection instead of claiming the configured server loaded", async () => {
  let selected = new Set<string>();
  const tool = createLoadMcpTool({
    getSettings: () => settings,
    getSelectedServerIds: () => selected,
    setSelectedServerIds: (next) => { selected = next; },
    refreshLoadedMcpTools: async () => ({
      statuses: [{ serverId: "local", state: "error", toolCount: 0, lastError: "Connection refused" }],
      toolCount: 0
    })
  });

  await assert.rejects(
    tool.execute("load-local", { action: "load", serverId: "local" }, new AbortController().signal),
    /could not be connected.*Connection refused/i
  );
  assert.equal(selected.has("local"), true, "selection remains so a later load can retry");
});

test("loadMcp judges the requested server instead of aggregate connected servers", async () => {
  const multiServerSettings = {
    ...settings,
    mcpServers: [
      settings.mcpServers[0],
      {
        ...settings.mcpServers[0],
        id: "broken",
        name: "Broken",
        toolNamePrefix: "broken"
      }
    ]
  } as unknown as RuntimeSettings;
  let selected = new Set(["local"]);
  const tool = createLoadMcpTool({
    getSettings: () => multiServerSettings,
    getSelectedServerIds: () => selected,
    setSelectedServerIds: (next) => { selected = next; },
    refreshLoadedMcpTools: async () => ({
      statuses: [
        { serverId: "local", state: "connected", toolCount: 2 },
        { serverId: "broken", state: "error", toolCount: 0, lastError: "Connection refused" }
      ],
      toolCount: 2
    })
  });

  await assert.rejects(
    tool.execute("load-broken", { action: "load", serverId: "broken" }, new AbortController().signal),
    /could not be connected: broken.*Connection refused/i
  );
  assert.equal(selected.has("broken"), true, "selection remains so a later turn can retry");
});

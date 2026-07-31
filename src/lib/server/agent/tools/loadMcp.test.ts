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
} as RuntimeSettings;

test("loadMcp reports a failed connection instead of claiming the configured server loaded", async () => {
  let selected = new Set<string>();
  const tool = createLoadMcpTool({
    getSettings: () => settings,
    getSelectedServerIds: () => selected,
    setSelectedServerIds: (next) => { selected = next; },
    refreshLoadedMcpTools: async () => ({ serverCount: 0, toolCount: 0, lastError: "Connection refused" })
  });

  await assert.rejects(
    tool.execute("load-local", { action: "load", serverId: "local" }, new AbortController().signal),
    /could not be connected.*Connection refused/i
  );
  assert.equal(selected.has("local"), true, "selection remains so a later load can retry");
});

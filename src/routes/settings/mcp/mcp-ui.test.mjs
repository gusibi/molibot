import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url) => readFileSync(url, "utf8");
const webPage = read(new URL("./+page.svelte", import.meta.url));
const desktopSection = read(new URL("../../../../apps/desktop/src/lib/settings/McpSection.svelte", import.meta.url));
const desktopStore = read(new URL("../../../../apps/desktop/src/lib/stores/mcp.svelte.ts", import.meta.url));
const desktopApi = read(new URL("../../../../apps/desktop/src/lib/api.ts", import.meta.url));
const desktopMcpServer = read(new URL("../../../../src/routes/api/desktop/mcp/+server.ts", import.meta.url));

test("Web MCP settings separate enablement from live connection management", () => {
  assert.match(webPage, /connectionState: "disabled" \| "connecting" \| "connected" \| "disconnected" \| "error"/);
  assert.match(webPage, /method: "PATCH"/);
  assert.match(webPage, /action: "reconnect"/);
  assert.match(webPage, /method: "DELETE"/);
  assert.match(webPage, /<IosSwitch[\s\S]*toggleServer\(item, enabled\)/);
  assert.match(webPage, /hasUnsavedJson/);
  assert.match(webPage, /mcp-connection-status/);
});

test("Desktop MCP settings expose shared switch, status, reconnect, and delete actions", () => {
  assert.match(desktopSection, /import IosSwitch from "\.\.\/components\/ui\/IosSwitch\.svelte"/);
  assert.match(desktopSection, /server\.connectionState/);
  assert.match(desktopSection, /toggleMcpServer\(server\.id, enabled\)/);
  assert.match(desktopSection, /reconnectMcp\(server\.id\)/);
  assert.match(desktopSection, /removeMcpServer\(server\.id\)/);
  assert.match(desktopStore, /toggleDesktopMcp/);
  assert.match(desktopStore, /reconnectDesktopMcp/);
  assert.doesNotMatch(desktopSection, /class="switch"/);
});

test("Desktop MCP auto-reconnects enabled servers on app reopen without stalling the list load", () => {
  // The server exposes a reconnectAll action that reuses the shared boot-time
  // reconcile primitive (connectEnabled: true) so every enabled server is
  // (re)connected idempotently. It is a POST, not the GET list path, so a
  // misconfigured server cannot stall the list load.
  assert.match(desktopMcpServer, /action === "reconnectAll"[\s\S]*liveSummary\(runtime, true\)/s);
  assert.doesNotMatch(desktopMcpServer, /summary: await liveSummary\(runtime, true\)[\s\S]*export const GET/s);
  // The desktop API + store fire reconnectAll once the loaded list shows an
  // enabled-but-disconnected server, so reopening the app brings MCP back
  // online without the user clicking Reconnect for each one.
  assert.match(desktopApi, /reconnectAllDesktopMcp/);
  assert.match(desktopApi, /action: "reconnectAll"/);
  assert.match(desktopStore, /reconnectAllDesktopMcp/);
  assert.match(desktopStore, /server\.enabled && server\.connectionState !== "connected"/);
  assert.match(desktopStore, /if \(endpoint === mcpStore\.endpoint\) mcpStore\.mcp = summary/);
});

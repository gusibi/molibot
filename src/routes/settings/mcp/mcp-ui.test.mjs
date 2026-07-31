import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (url) => readFileSync(url, "utf8");
const webPage = read(new URL("./+page.svelte", import.meta.url));
const desktopSection = read(new URL("../../../../apps/desktop/src/lib/settings/McpSection.svelte", import.meta.url));
const desktopStore = read(new URL("../../../../apps/desktop/src/lib/stores/mcp.svelte.ts", import.meta.url));

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

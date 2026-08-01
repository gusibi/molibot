import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDesktopOpenConnectorSummary, normalizeOpenConnectorUrl, projectOpenConnectorConfig, saveOpenConnectorSettings } from "./desktopOpenConnector.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { effectiveMcpServers } from "$lib/server/settings/openConnector.js";

test("OpenConnector projection never returns the Runtime Token and derives one MCP server", () => {
  const settings = { ...defaultRuntimeSettings, openConnector: { enabled: true, baseUrl: "https://opc.example.com", consoleUrl: "https://opc.example.com/providers", runtimeToken: "oct-secret" } };
  assert.deepEqual(projectOpenConnectorConfig(settings), { enabled: true, baseUrl: "https://opc.example.com", consoleUrl: "https://opc.example.com/providers", tokenConfigured: true });
  const managed = effectiveMcpServers(settings).find((server) => server.id === "open-connector");
  assert.equal(managed?.http.url, "https://opc.example.com/mcp");
  assert.equal(managed?.http.headers.Authorization, "Bearer oct-secret");
  assert.doesNotMatch(JSON.stringify(projectOpenConnectorConfig(settings)), /oct-secret/);
});

test("OpenConnector save preserves a hidden token and rejects unsafe or cross-origin URLs", () => {
  const settings = { ...defaultRuntimeSettings, openConnector: { enabled: false, baseUrl: "https://old.example.com", consoleUrl: "https://old.example.com/providers", runtimeToken: "oct-secret" } };
  assert.equal(saveOpenConnectorSettings(settings, { enabled: true, baseUrl: "https://new.example.com", consoleUrl: "https://new.example.com/providers" }).runtimeToken, "oct-secret");
  assert.equal(saveOpenConnectorSettings(settings, { clearRuntimeToken: true }).runtimeToken, "");
  assert.throws(() => normalizeOpenConnectorUrl("http://example.com"), /HTTPS/);
  assert.throws(() => saveOpenConnectorSettings(settings, { baseUrl: "https://one.example.com", consoleUrl: "https://two.example.com/providers" }), /same origin/);
});

test("OpenConnector refresh caches provider metadata, logos, and active runtime apps for later page loads", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const tempDir = mkdtempSync(join(tmpdir(), "molibot-open-connector-"));
  const cacheFile = join(tempDir, "catalog.json");
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  let fetchCount = 0;
  globalThis.fetch = async (input, init) => {
    fetchCount += 1;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer oct-secret");
    if (String(input).endsWith("/v1/providers")) return Response.json({ success: true, data: [
      { service: "github", displayName: "GitHub", homepageUrl: "https://github.com", categories: [{ id: "developer-tools", displayName: "Developer Tools" }], authTypes: ["api_key"] },
      { service: "googlecalendar", displayName: "Google Calendar", homepageUrl: "https://calendar.google.com", categories: ["Productivity"] }
    ] });
    assert.ok(String(input).endsWith("/v1/apps"));
    return Response.json({ success: true, data: [
      { id: "app-1", service: "github", status: "active", alias: "work", authType: "api_key", displayName: "Gusibi" },
      { id: "app-2", service: "slack", status: "disconnected", alias: "default", authType: "oauth2", displayName: "Team" }
    ] });
  };
  const settings = { ...defaultRuntimeSettings, openConnector: { enabled: true, baseUrl: "https://opc.example.com", consoleUrl: "https://opc.example.com/providers", runtimeToken: "oct-secret" } };
  const summary = await buildDesktopOpenConnectorSummary(settings, { refresh: true, cacheFile });
  assert.equal(summary.state, "ready");
  assert.deepEqual(summary.providers[0]?.categories, ["Developer Tools"]);
  assert.equal(summary.providers[0]?.iconUrl, "https://www.google.com/s2/favicons?sz=64&domain=github.com");
  assert.equal(summary.providers[1]?.iconUrl, "https://api.iconify.design/logos/google-calendar.svg");
  assert.equal(summary.connections[0]?.service, "github");
  assert.equal(summary.connections[0]?.connectionName, "work");
  assert.equal(summary.connections[0]?.displayName, "Gusibi");
  assert.equal(summary.connections.length, 1);
  assert.equal(fetchCount, 2);
  assert.equal(existsSync(cacheFile), true);
  assert.equal(JSON.parse(readFileSync(cacheFile, "utf8")).baseUrl, "https://opc.example.com");
  assert.doesNotMatch(JSON.stringify(summary), /oct-secret/);

  globalThis.fetch = async () => { throw new Error("page load must not access the network"); };
  const cached = await buildDesktopOpenConnectorSummary(settings, { cacheFile });
  assert.deepEqual(cached.providers, summary.providers);
  assert.deepEqual(cached.connections, summary.connections);
  assert.equal(cached.refreshedAt, summary.refreshedAt);
});

test("OpenConnector page load does not reuse a catalog from another runtime", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "molibot-open-connector-scope-"));
  const cacheFile = join(tempDir, "catalog.json");
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const settings = { ...defaultRuntimeSettings, openConnector: { enabled: true, baseUrl: "https://one.example.com", consoleUrl: "https://one.example.com/providers", runtimeToken: "oct-secret" } };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => String(input).endsWith("/v1/providers")
    ? Response.json({ success: true, data: [{ service: "github", displayName: "GitHub" }] })
    : Response.json({ success: true, data: [] });
  await buildDesktopOpenConnectorSummary(settings, { refresh: true, cacheFile });
  const other = { ...settings, openConnector: { ...settings.openConnector, baseUrl: "https://two.example.com", consoleUrl: "https://two.example.com/providers" } };
  const summary = await buildDesktopOpenConnectorSummary(other, { cacheFile });
  assert.deepEqual(summary.providers, []);
  assert.equal(summary.refreshedAt, "");
});

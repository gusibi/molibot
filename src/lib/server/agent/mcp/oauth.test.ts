import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { McpOAuthManager } from "./oauth.js";
import { McpOAuthStore, mcpOAuthStorePath } from "./oauthStore.js";

function server(id: string, mode: "headers" | "oauth", url = "https://mcp.example.com/mcp"): McpServerConfig {
  return { id, name: id, enabled: true, transport: "http", stdio: { command: "", args: [], env: {}, cwd: "" },
    http: { url, headers: {} }, auth: { mode, oauth: { authServerMetadataUrl: "", clientName: "" } }, toolNamePrefix: "" };
}

test("OAuth status reports authorization, expiry and logout without exposing tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-auth-"));
  try {
    const store = new McpOAuthStore(mcpOAuthStorePath(directory));
    const manager = new McpOAuthManager({ store });
    const oauth = server("remote", "oauth");
    const headers = server("legacy", "headers");

    assert.deepEqual(manager.authStatus(headers), { mode: "headers", state: "not_applicable" });
    assert.deepEqual(manager.authStatus(oauth), { mode: "oauth", state: "unauthorized" });

    store.forScope(manager.scopeFor(oauth)).save({ serverUrl: oauth.http.url, tokensExpireAt: Date.now() + 60_000, tokens: { access_token: "secret" } } as never);
    const authorized = manager.authStatus(oauth);
    assert.equal(authorized.state, "authorized");
    assert.equal(JSON.stringify(authorized).includes("secret"), false);

    store.forScope(manager.scopeFor(oauth)).save({ serverUrl: oauth.http.url, tokensExpireAt: Date.now() - 1, tokens: { access_token: "secret" } } as never);
    assert.equal(manager.authStatus(oauth).state, "expired");

    await manager.logout(oauth);
    assert.equal(manager.authStatus(oauth).state, "unauthorized");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("forgetting a deleted server leaves a sibling configuration of the same URL signed in", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-auth-siblings-"));
  try {
    const store = new McpOAuthStore(mcpOAuthStorePath(directory));
    const manager = new McpOAuthManager({ store });
    const removed = server("primary", "oauth");
    const sibling = server("secondary", "oauth", "https://mcp.example.com/mcp");
    store.forScope(manager.scopeFor(removed)).save({ serverUrl: removed.http.url, tokens: { access_token: "one" } } as never);
    store.forScope(manager.scopeFor(sibling)).save({ serverUrl: sibling.http.url, tokens: { access_token: "two" } } as never);

    manager.forgetServer("primary");
    assert.equal(manager.authStatus(removed).state, "unauthorized");
    assert.equal(manager.authStatus(sibling).state, "authorized");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

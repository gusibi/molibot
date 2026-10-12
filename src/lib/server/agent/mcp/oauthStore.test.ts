import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpOAuthStore, mcpOAuthScopeKey, mcpOAuthStorePath, type McpOAuthScope } from "./oauthStore.js";

const scope = (serverId: string, url: string, authServerMetadataUrl = ""): McpOAuthScope => ({ serverId, url, authServerMetadataUrl });

test("OAuth records stay isolated per server identity, URL and authorization server", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-oauth-"));
  try {
    const store = new McpOAuthStore(mcpOAuthStorePath(directory));
    const primary = scope("remote", "https://mcp.example.com/mcp");
    const twin = scope("remote-twin", "https://mcp.example.com/mcp");
    const moved = scope("remote", "https://other.example.com/mcp");
    const overridden = scope("remote", "https://mcp.example.com/mcp", "https://auth.example.com/.well-known/oauth-authorization-server");
    for (const target of [primary, twin, moved, overridden]) store.forScope(target).save({ serverUrl: target.url } as never);
    assert.equal(store.forScope(primary).load()?.serverUrl, "https://mcp.example.com/mcp");
    assert.notEqual(mcpOAuthScopeKey(primary), mcpOAuthScopeKey(twin));
    assert.notEqual(mcpOAuthScopeKey(primary), mcpOAuthScopeKey(moved));
    assert.notEqual(mcpOAuthScopeKey(primary), mcpOAuthScopeKey(overridden));

    // Deleting one server clears every URL/auth-server record it owns, and nothing else.
    store.removeServer("remote");
    assert.equal(store.forScope(primary).load(), undefined);
    assert.equal(store.forScope(moved).load(), undefined);
    assert.equal(store.forScope(overridden).load(), undefined);
    assert.equal(store.forScope(twin).load()?.serverUrl, "https://mcp.example.com/mcp");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("OAuth records survive a new store instance and removing one scope leaves the rest", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-oauth-reload-"));
  try {
    const first = scope("a", "https://a/mcp");
    const second = scope("b", "https://b/mcp");
    const store = new McpOAuthStore(mcpOAuthStorePath(directory));
    store.forScope(first).save({ serverUrl: first.url, tokens: { access_token: "secret" } } as never);
    store.forScope(second).save({ serverUrl: second.url, tokens: { access_token: "other" } } as never);

    const reloaded = new McpOAuthStore(mcpOAuthStorePath(directory));
    assert.equal(reloaded.forScope(first).load()?.tokens?.access_token, "secret");
    reloaded.remove(first);
    assert.equal(reloaded.forScope(first).load(), undefined);
    assert.equal(new McpOAuthStore(mcpOAuthStorePath(directory)).forScope(second).load()?.tokens?.access_token, "other");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

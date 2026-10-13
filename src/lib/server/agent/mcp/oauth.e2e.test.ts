import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpClient, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import {
  adaptOAuthProvider,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
  OAuthCallbackServer
} from "@earendil-works/pi-mcp/oauth";
import type { McpOAuthConfig, McpServerConfig } from "$lib/server/settings/schema.js";
import { callMcpToolWithTimeout, McpToolRegistry } from "$lib/server/agent/tools/mcp.js";
import { McpOAuthManager, withMcpOAuthCall } from "./oauth.js";
import { McpOAuthStore, mcpOAuthStorePath } from "./oauthStore.js";

/**
 * End-to-end MCP OAuth against a local, in-process authorization server and a
 * local Streamable HTTP MCP resource. Every protocol step Molibot delegates to
 * Pi is exercised for real — discovery, dynamic client registration, PKCE S256,
 * `state` echo, RFC 9207 `iss`, refresh, and step-up scopes — so the integration
 * is validated by observable HTTP behaviour, not by re-asserting adapter shapes.
 */

import { startFixture, oauthServer, tempManager, completeBrowser } from "../../../../../evals/lib/oauthFixture.js";

test("full login performs discovery, registration, PKCE, state and issuer exchange", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);

    assert.equal(manager.authStatus(server).state, "authorizing");
    assert.ok(session.authorizationUrl.startsWith(`${fixture.asUrl}/authorize`));
    const params = new URL(session.authorizationUrl).searchParams;
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(params.get("response_type"), "code");
    assert.ok(params.get("code_challenge"));
    assert.ok(params.get("state"));

    await completeBrowser(session.authorizationUrl);
    await task;

    assert.equal(fixture.tokenExchangeSucceeded, true, "the AS must have verified the PKCE verifier");
    assert.deepEqual(manager.authStatus(server).state, "authorized");
    assert.equal(fixture.metadataFetches.includes("/.well-known/oauth-authorization-server"), true);
    // Raw credentials never reach the status object.
    assert.equal(JSON.stringify(manager.authStatus(server)).includes("at_"), false);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a callback carrying the wrong state is rejected and the correct one still completes", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);

    const redirect = await fetch(session.authorizationUrl, { redirect: "manual" });
    const location = new URL(redirect.headers.get("location")!);
    const tampered = new URL(location);
    tampered.searchParams.set("state", "not-the-pending-state");
    const rejected = await fetch(tampered);
    assert.equal(rejected.status, 400);
    assert.equal(manager.authStatus(server).state, "authorizing", "a wrong-state callback must not settle the login");

    const accepted = await fetch(location);
    assert.equal(accepted.status, 200);
    await task;
    assert.equal(manager.authStatus(server).state, "authorized");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an authorization server whose metadata issuer disagrees with its URL is rejected", async () => {
  const fixture = await startFixture({ metadataIssuerOverride: "http://auth.example.test" });
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    await assert.rejects(() => manager.beginLogin(server), /issuer/i);
    assert.equal(manager.authStatus(server).state, "unauthorized");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a redirect whose RFC 9207 iss does not match the authorization server fails the login", async () => {
  const fixture = await startFixture({ authorizationIssuerOverride: "http://impostor.example.test" });
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);
    await completeBrowser(session.authorizationUrl);
    await task;
    const status = manager.authStatus(server);
    assert.equal(status.state, "error");
    assert.match(status.error ?? "", /issuer/i);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a configured authorization server metadata URL authorizes even when discovery is unavailable", async () => {
  const fixture = await startFixture({
    hideDiscovery: true,
    overrideMetadataIssuer: "http://trusted-auth.test",
    authorizationIssuerOverride: "http://trusted-auth.test"
  });
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl, { authServerMetadataUrl: fixture.overrideMetadataUrl! });
    const { session, task } = await manager.beginLogin(server);
    await completeBrowser(session.authorizationUrl);
    await task;
    assert.equal(manager.authStatus(server).state, "authorized");
    assert.equal(fixture.metadataFetches.includes("/override-metadata"), true);
    assert.equal(fixture.metadataFetches.includes("/.well-known/oauth-authorization-server"), false);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a refresh obtains a new access token and the transport retries with it", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);
    await completeBrowser(session.authorizationUrl);
    await task;
    const firstToken = [...fixture.validAccessTokens][0];

    const transport = new StreamableHttpTransport({ url: fixture.mcpUrl, authProvider: manager.authProvider(server), openGetStream: false });
    const client = new McpClient({ name: "test", version: "0.0.0", capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["echo", "admin_action"]);

    // The resource forgets the access token; only a refresh can restore access.
    fixture.revokeAccessTokens();
    const result = await client.callTool("echo", { text: "hello" });
    assert.equal((result.content[0] as { text: string }).text, "echo:hello");
    assert.equal(fixture.refreshCalls, 1);
    assert.notEqual([...fixture.validAccessTokens][0], firstToken);
    await client.close();
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a completed login lets the registry reconnect and rediscover tools", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const registry = new McpToolRegistry(manager);
    const options = { workspaceDir: directory };

    // Before authorization the resource rejects the connection.
    assert.deepEqual(await registry.getTools([server], options), []);
    const before = registry.getStatuses([server], directory)[0];
    assert.equal(before.state, "error");
    assert.equal(before.auth?.state, "unauthorized");

    const { session, task } = await manager.beginLogin(server);
    await completeBrowser(session.authorizationUrl);
    await task;

    await registry.reconcile([server], { ...options, connectEnabled: true });
    const after = registry.getStatuses([server], directory)[0];
    assert.equal(after.state, "connected");
    assert.equal(after.toolCount, 2);
    assert.equal(after.auth?.state, "authorized");

    const tools = await registry.getTools([server], options);
    const echo = tools.find((tool) => tool.name === "mcp__remote__echo");
    assert.ok(echo);
    const called = await echo.execute("call-1", { text: "via-registry" }, undefined, undefined);
    assert.equal((called.content[0] as { text: string }).text, "echo:via-registry");
    await registry.closeAll();
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("credentials on disk survive a new manager, and logout/delete are isolated", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const first = oauthServer("primary", fixture.mcpUrl);
    const sibling = oauthServer("secondary", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(first);
    await completeBrowser(session.authorizationUrl);
    await task;
    assert.equal(manager.authStatus(first).state, "authorized");
    assert.equal(manager.authStatus(sibling).state, "unauthorized");

    // A fresh manager reads the same protected file: credentials survive restart.
    const restarted = new McpOAuthManager({ store: new McpOAuthStore(mcpOAuthStorePath(directory)) });
    assert.equal(restarted.authStatus(first).state, "authorized");
    assert.equal(restarted.authStatus(sibling).state, "unauthorized");

    manager.forgetServer("primary");
    assert.equal(manager.authStatus(first).state, "unauthorized");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("re-authorization requests the union of granted and advertised scopes", async () => {
  const fixture = await startFixture();
  const { manager, store, directory } = tempManager();
  let pendingLoginId: string | undefined;
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    // A first login caches discovery and the client registration.
    const first = await manager.beginLogin(server);
    await completeBrowser(first.session.authorizationUrl);
    await first.task;

    // Simulate a step-up that only granted an extra scope beyond the advertised default.
    const scopeStore = store.forScope(manager.scopeFor(server));
    const state = scopeStore.load()!;
    scopeStore.save({ ...state, tokens: { ...state.tokens!, scope: "mcp.admin" } });

    const reauth = await manager.beginLogin(server, { force: true });
    pendingLoginId = reauth.session.id;
    const scope = new URL(reauth.session.authorizationUrl).searchParams.get("scope") ?? "";
    assert.match(scope, /\bmcp\.read\b/, "the advertised default must be requested again");
    assert.match(scope, /\bmcp\.admin\b/, "a previously granted scope must not be dropped");
  } finally {
    // Close the callback listener even if an assertion failed, or the process hangs.
    if (pendingLoginId) await manager.closeLogin(pendingLoginId).catch(() => undefined);
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("logout while authorizing prevents a late callback from reviving the grant", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);
    const redirect = await fetch(session.authorizationUrl, { redirect: "manual" });
    const callbackLocation = redirect.headers.get("location")!;

    await manager.logout(server);
    await task;
    assert.equal(manager.authStatus(server).state, "unauthorized");

    // The callback listener is closed, so the late redirect cannot complete anything.
    await assert.rejects(() => fetch(callbackLocation));
    assert.equal(manager.authStatus(server).state, "unauthorized");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a step-up challenge surfaces as an actionable authorization requirement", async () => {
  const fixture = await startFixture({ protectedToolScope: "mcp.admin" });
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server);
    await completeBrowser(session.authorizationUrl);
    await task;

    const transport = new StreamableHttpTransport({ url: fixture.mcpUrl, authProvider: manager.authProvider(server), openGetStream: false });
    const client = new McpClient({ name: "test", version: "0.0.0", capabilities: {} });
    await client.connect(transport);
    await assert.rejects(
      () => client.callTool("admin_action", {}),
      (error: unknown) => error instanceof McpOAuthAuthorizationRequiredError
    );
    await client.close();
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a step-up challenge requests the union of granted and challenged scopes", async () => {
  const fixture = await startFixture();
  try {
    // The auth provider Molibot installs must carry the already-granted scope into
    // the step-up so gaining the challenged scope never loses the old one (SEP-2350).
    const store = new MemoryOAuthStateStore();
    store.save({ serverUrl: fixture.mcpUrl, tokens: { access_token: "old", token_type: "Bearer", scope: "mcp.read" } });
    let authorizationUrl: URL | undefined;
    const provider = new McpOAuthProvider({
      serverUrl: fixture.mcpUrl,
      redirectUrl: "http://127.0.0.1:9/callback",
      clientMetadata: { client_name: "Molibot" },
      store,
      onRedirect: (url) => { authorizationUrl = url; }
    });

    const challenge = new Response("", {
      status: 403,
      headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="mcp.admin", resource_metadata="${fixture.protectedResourceMetadataUrl}"` }
    });
    await assert.rejects(
      () => adaptOAuthProvider(provider).onUnauthorized!({ response: challenge, serverUrl: new URL(fixture.mcpUrl), fetch: globalThis.fetch, token: "old" }),
      (error: unknown) => error instanceof McpOAuthAuthorizationRequiredError
    );

    assert.ok(authorizationUrl, "the step-up must ask for a fresh authorization");
    const scope = authorizationUrl!.searchParams.get("scope") ?? "";
    assert.match(scope, /\bmcp\.read\b/, "the already granted scope must be preserved");
    assert.match(scope, /\bmcp\.admin\b/, "the challenged scope must be requested");
  } finally {
    await fixture.close();
  }
});

test("the redirect URI is taken from the callback listener, so an aliased or proxied host can be advertised", async () => {
  const fixture = await startFixture();
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-oauth-e2e-"));
  let advertised = "";
  const manager = new McpOAuthManager({
    store: new McpOAuthStore(mcpOAuthStorePath(directory)),
    // A public Web deployment serves the callback behind its own host/reverse
    // proxy; the manager must not hardcode loopback. It advertises whatever URL
    // the listener reports.
    listenCallback: async () => {
      const callback = await OAuthCallbackServer.listen({ redirectHost: "auth-host.example.test" });
      advertised = callback.redirectUrl;
      return callback;
    }
  });
  let pendingId: string | undefined;
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session } = await manager.beginLogin(server);
    pendingId = session.id;
    const redirectUri = new URL(session.authorizationUrl).searchParams.get("redirect_uri");
    assert.equal(redirectUri, advertised);
    assert.match(advertised, /^http:\/\/auth-host\.example\.test:\d+\/callback$/);
  } finally {
    if (pendingId) await manager.closeLogin(pendingId).catch(() => undefined);
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a deployment callback forwards to Pi without cookies and rejects reuse", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const { session, task } = await manager.beginLogin(server, { callbackOrigin: "https://molibot.example.test" });
    const callbackUri = new URL(session.authorizationUrl).searchParams.get("redirect_uri")!;
    assert.match(callbackUri, /^https:\/\/molibot\.example\.test\/api\/mcp\/oauth\/callback\//);
    const redirect = await fetch(session.authorizationUrl, { redirect: "manual" });
    const location = new URL(redirect.headers.get("location")!);
    const id = location.pathname.split("/").pop()!;
    const wrong = new URL(location); wrong.searchParams.set("state", "wrong");
    assert.equal((await manager.forwardCallback(id, wrong)).status, 400);
    assert.equal((await manager.forwardCallback(id, location)).status, 200);
    await task;
    assert.equal(manager.authStatus(server).state, "authorized");
    assert.equal((await manager.forwardCallback(id, location)).status, 410);
  } finally { await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("a challenged safe request resumes after step-up, and unattended requests never wait", async () => {
  const fixture = await startFixture({ protectedToolScope: "mcp.admin" });
  const { manager, directory } = tempManager();
  let client: McpClient | undefined;
  try {
    const server = oauthServer("remote", fixture.mcpUrl);
    const login = await manager.beginLogin(server); await completeBrowser(login.session.authorizationUrl); await login.task;
    client = new McpClient({ name: "test", version: "0", capabilities: {} });
    await client.connect(new StreamableHttpTransport({ url: fixture.mcpUrl, authProvider: manager.authProvider(server), openGetStream: false }));
    await assert.rejects(withMcpOAuthCall({ interactive: false, replaySafe: true }, () => client!.callTool("admin_action", {})), McpOAuthAuthorizationRequiredError);
    const controller = new AbortController();
    const call = withMcpOAuthCall({ interactive: true, replaySafe: true, signal: controller.signal }, () => client!.callTool("admin_action", {}, { signal: controller.signal }));
    const deadline = Date.now() + 3000;
    while (fixture.challenges < 2 || manager.authStatus(server).state !== "error") { if (Date.now() > deadline) throw new Error("Missing step-up state"); await new Promise(resolve => setTimeout(resolve, 10)); }
    const next = await manager.beginLogin(server, { force: true });
    assert.match(new URL(next.session.authorizationUrl).searchParams.get("scope")!, /mcp.admin/);
    await completeBrowser(next.session.authorizationUrl); await next.task;
    assert.ok(await call);
    assert.equal(manager.authStatus(server).state, "authorized");
  } finally { await client?.close(); await manager.logout(oauthServer("remote", fixture.mcpUrl)); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("concurrent logins retain only the latest attempt and logout defeats a late callback", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  const server = oauthServer("remote", fixture.mcpUrl);
  try {
    const attempts = await Promise.allSettled([manager.beginLogin(server), manager.beginLogin(server)]);
    assert.equal(attempts[0].status, "rejected");
    assert.equal(attempts[1].status, "fulfilled");
    const latest = (attempts[1] as PromiseFulfilledResult<Awaited<ReturnType<McpOAuthManager["beginLogin"]>>>).value;
    await completeBrowser(latest.session.authorizationUrl); await latest.task;
    assert.equal(manager.authStatus(server).state, "authorized");
    const next = await manager.beginLogin(server, { force: true });
    const redirect = await fetch(next.session.authorizationUrl, { redirect: "manual" });
    await manager.logout(server);
    await next.task;
    await assert.rejects(fetch(redirect.headers.get("location")!));
    assert.equal(manager.authStatus(server).state, "unauthorized");
  } finally { await manager.logout(server); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("signing out during token exchange prevents a late grant from restoring credentials", async () => {
  let entered!: () => void; let release!: () => void;
  const exchange = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const fixture = await startFixture({ beforeTokenExchange: async () => { entered(); await barrier; } });
  const { manager, directory } = tempManager(); const server = oauthServer("remote", fixture.mcpUrl);
  try {
    const login = await manager.beginLogin(server);
    await completeBrowser(login.session.authorizationUrl);
    await exchange;
    await manager.logout(server);
    release(); await login.task;
    assert.equal(fixture.tokenExchangeSucceeded, true);
    assert.equal(manager.authStatus(server).state, "unauthorized");
  } finally { release(); await manager.logout(server); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("parallel clients share one refresh without losing either response", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  const clients: McpClient[] = [];
  const server = oauthServer("parallel", fixture.mcpUrl);
  try {
    const login = await manager.beginLogin(server); await completeBrowser(login.session.authorizationUrl); await login.task;
    for (let n = 0; n < 2; n++) {
      const client = new McpClient({ name: `parallel-${n}`, version: "0", capabilities: {} }); clients.push(client);
      await client.connect(new StreamableHttpTransport({ url: fixture.mcpUrl, authProvider: manager.authProvider(server), openGetStream: false }));
    }
    fixture.revokeAccessTokens();
    const results = await Promise.all(clients.map((client, n) => client.callTool("echo", { text: String(n) })));
    assert.deepEqual(results.map(result => (result.content[0] as { text: string }).text), ["echo:0", "echo:1"]);
    assert.equal(fixture.refreshCalls, 1);
  } finally { await Promise.all(clients.map(client => client.close())); await manager.logout(server); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("an unsafe challenge waits for authorization without replaying the operation", async () => {
  const fixture = await startFixture({ protectedToolScope: "mcp.admin" });
  const { manager, directory } = tempManager();
  const server = oauthServer("unsafe", fixture.mcpUrl);
  const client = new McpClient({ name: "unsafe", version: "0", capabilities: {} });
  try {
    const login = await manager.beginLogin(server); await completeBrowser(login.session.authorizationUrl); await login.task;
    await client.connect(new StreamableHttpTransport({ url: fixture.mcpUrl, authProvider: manager.authProvider(server), openGetStream: false }));
    const call = withMcpOAuthCall({ interactive: true, replaySafe: false }, () => client.callTool("admin_action", {}));
    const rejected = assert.rejects(call, /original operation was not replayed/);
    const deadline = Date.now() + 3000;
    while (!fixture.challenges) { if (Date.now() > deadline) throw new Error("No challenge"); await new Promise(resolve => setTimeout(resolve, 10)); }
    const next = await manager.beginLogin(server, { force: true }); await completeBrowser(next.session.authorizationUrl); await next.task;
    await rejected;
    assert.equal(fixture.challenges, 1);
    assert.equal(manager.authStatus(server).state, "authorized");
  } finally { await client.close(); await manager.logout(server); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("changing a registered resource invalidates its pending callback", async () => {
  const fixture = await startFixture();
  const { manager, directory } = tempManager();
  const server = oauthServer("changed", fixture.mcpUrl);
  const registry = new McpToolRegistry(manager);
  try {
    await registry.reconcile([server], { workspaceDir: directory, connectEnabled: true });
    const login = await manager.beginLogin(server);
    const redirect = await fetch(login.session.authorizationUrl, { redirect: "manual" });
    const next = { ...server, http: { ...server.http, url: `${fixture.mcpUrl}?new-resource=1` } };
    await registry.reconcile([next], { workspaceDir: directory, connectEnabled: false });
    await login.task;
    await assert.rejects(fetch(redirect.headers.get("location")!));
    assert.equal(manager.authStatus(next).state, "unauthorized");
  } finally { await registry.reconcile([], { workspaceDir: directory }); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("a timed-out OAuth challenge cannot replay after a late authorization", async () => {
  const fixture = await startFixture({ protectedToolScope: "mcp.admin" }); const { manager, directory } = tempManager();
  const server = oauthServer("timeout", fixture.mcpUrl); const client = new McpClient({ name: "timeout", version: "0", capabilities: {} });
  const requests: unknown[] = []; let finished!: () => void; const authorizationSettled = new Promise<void>(resolve => { finished = resolve; });
  try {
    const login = await manager.beginLogin(server); await completeBrowser(login.session.authorizationUrl); await login.task;
    const provider = manager.authProvider(server);
    await client.connect(new StreamableHttpTransport({ url: fixture.mcpUrl, openGetStream: false,
      authProvider: { ...provider, onUnauthorized: async context => { try { await provider.onUnauthorized?.(context); } finally { finished(); } } },
      fetch: async (url, init) => { const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; if (body?.method === "tools/call") requests.push(body); return fetch(url, init); }
    }));
    await assert.rejects(withMcpOAuthCall({ interactive: true, replaySafe: true }, () => callMcpToolWithTimeout(client, "admin_action", {}, undefined, 70)), /timed out/);
    const next = await manager.beginLogin(server, { force: true }); await completeBrowser(next.session.authorizationUrl); await next.task;
    await authorizationSettled; await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(manager.authStatus(server).state, "authorized"); assert.equal(requests.length, 1);
  } finally { await manager.logout(server); await client.close(); await fixture.close(); rmSync(directory, { recursive: true, force: true }); }
});

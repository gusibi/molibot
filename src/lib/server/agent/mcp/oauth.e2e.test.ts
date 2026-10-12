import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
import { McpToolRegistry } from "$lib/server/agent/tools/mcp.js";
import { McpOAuthManager } from "./oauth.js";
import { McpOAuthStore, mcpOAuthStorePath } from "./oauthStore.js";

/**
 * End-to-end MCP OAuth against a local, in-process authorization server and a
 * local Streamable HTTP MCP resource. Every protocol step Molibot delegates to
 * Pi is exercised for real — discovery, dynamic client registration, PKCE S256,
 * `state` echo, RFC 9207 `iss`, refresh, and step-up scopes — so the integration
 * is validated by observable HTTP behaviour, not by re-asserting adapter shapes.
 */

type Json = Record<string, unknown>;

interface FixtureOptions {
  /** Serve a wrong `issuer` in the AS metadata to exercise issuer validation. */
  metadataIssuerOverride?: string;
  /** Send a wrong `iss` on the authorization redirect (RFC 9207). */
  authorizationIssuerOverride?: string;
  /** Disable the RFC 8414 well-known endpoint so only a metadata override works. */
  hideDiscovery?: boolean;
  /** Serve a second metadata document with a trusted-but-different issuer for overrides. */
  overrideMetadataIssuer?: string;
  /** scopes required by `tools/call`; a granted token without them gets a 403 step-up. */
  protectedToolScope?: string;
}

interface Fixture {
  asUrl: string;
  mcpUrl: string;
  protectedResourceMetadataUrl: string;
  overrideMetadataUrl?: string;
  /** Access tokens the resource currently accepts. */
  validAccessTokens: Set<string>;
  accessTokenScopes: Map<string, string>;
  refreshTokens: Set<string>;
  refreshCalls: number;
  tokenExchangeSucceeded: boolean;
  metadataFetches: string[];
  lastAuthorizationParams: URLSearchParams | null;
  /** Invalidate access tokens but keep refresh tokens, forcing a refresh on the next call. */
  revokeAccessTokens(): void;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture did not bind TCP"));
      else resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function startFixture(options: FixtureOptions = {}): Promise<Fixture> {
  // Live counters shared with the request handlers; the returned fixture exposes
  // them through getters so tests observe mutations, not a snapshot.
  const counters = {
    validAccessTokens: new Set<string>(),
    accessTokenScopes: new Map<string, string>(),
    refreshTokens: new Set<string>(),
    refreshCalls: 0,
    tokenExchangeSucceeded: false,
    metadataFetches: [] as string[],
    lastAuthorizationParams: null as URLSearchParams | null
  };

  const authorizationCodes = new Map<string, { challenge: string; redirectUri: string; clientId: string; scope: string }>();
  let tokenCounter = 0;
  let asPort = 0;
  let asUrl = "";
  let mcpUrl = "";
  let overrideMetadataUrl: string | undefined;
  const protectedResourceMetadataUrl = { value: "" };

  const asMetadata = (issuer: string): Json => ({
    issuer,
    authorization_endpoint: `${asUrl}/authorize`,
    token_endpoint: `${asUrl}/token`,
    registration_endpoint: `${asUrl}/register`,
    scopes_supported: ["mcp.read"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true
  });

  const issueTokens = (scope: string): Json => {
    tokenCounter += 1;
    const access = `at_${tokenCounter}`;
    const refresh = `rt_${tokenCounter}`;
    counters.validAccessTokens.add(access);
    counters.accessTokenScopes.set(access, scope);
    counters.refreshTokens.add(refresh);
    return { access_token: access, token_type: "Bearer", expires_in: 3600, scope, refresh_token: refresh };
  };

  const asServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", asUrl || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        counters.metadataFetches.push(url.pathname);
        if (options.hideDiscovery) {
          response.writeHead(404).end();
          return;
        }
        sendJson(response, 200, asMetadata(options.metadataIssuerOverride ?? asUrl));
        return;
      }
      if (request.method === "GET" && url.pathname === "/override-metadata") {
        counters.metadataFetches.push(url.pathname);
        sendJson(response, 200, asMetadata(options.overrideMetadataIssuer ?? asUrl));
        return;
      }
      if (request.method === "POST" && url.pathname === "/register") {
        const body = JSON.parse(await readBody(request)) as Json;
        sendJson(response, 201, { client_id: randomUUID(), redirect_uris: body.redirect_uris ?? [] });
        return;
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        counters.lastAuthorizationParams = url.searchParams;
        const code = randomUUID();
        authorizationCodes.set(code, {
          challenge: url.searchParams.get("code_challenge") ?? "",
          redirectUri: url.searchParams.get("redirect_uri") ?? "",
          clientId: url.searchParams.get("client_id") ?? "",
          scope: url.searchParams.get("scope") ?? ""
        });
        const redirect = new URL(url.searchParams.get("redirect_uri")!);
        redirect.searchParams.set("code", code);
        const echoedState = url.searchParams.get("state");
        if (echoedState) redirect.searchParams.set("state", echoedState);
        redirect.searchParams.set("iss", options.authorizationIssuerOverride ?? asUrl);
        response.writeHead(302, { location: redirect.toString() }).end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/token") {
        const params = new URLSearchParams(await readBody(request));
        const grantType = params.get("grant_type");
        if (grantType === "refresh_token") {
          counters.refreshCalls += 1;
          const refresh = params.get("refresh_token") ?? "";
          if (!counters.refreshTokens.has(refresh)) {
            sendJson(response, 400, { error: "invalid_grant" });
            return;
          }
          counters.refreshTokens.delete(refresh);
          sendJson(response, 200, issueTokens("mcp.read"));
          return;
        }
        if (grantType === "authorization_code") {
          const record = authorizationCodes.get(params.get("code") ?? "");
          if (!record) {
            sendJson(response, 400, { error: "invalid_grant", error_description: "unknown code" });
            return;
          }
          const verifier = params.get("code_verifier") ?? "";
          if (pkceChallenge(verifier) !== record.challenge) {
            sendJson(response, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
            return;
          }
          if (params.get("client_id") !== record.clientId) {
            sendJson(response, 400, { error: "invalid_client" });
            return;
          }
          authorizationCodes.delete(params.get("code")!);
          counters.tokenExchangeSucceeded = true;
          sendJson(response, 200, issueTokens(record.scope || "mcp.read"));
          return;
        }
        sendJson(response, 400, { error: "unsupported_grant_type" });
        return;
      }
      response.writeHead(404).end();
    })().catch((error) => response.writeHead(500).end(String(error)));
  });

  const mcpServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", mcpUrl || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        sendJson(response, 200, {
          resource: mcpUrl,
          authorization_servers: [asUrl],
          scopes_supported: ["mcp.read"]
        });
        return;
      }
      if (url.pathname !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      if (request.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      if (request.method === "DELETE") {
        response.writeHead(204).end();
        return;
      }
      const authorization = request.headers.authorization ?? "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!counters.validAccessTokens.has(token)) {
        response.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl.value}", error="invalid_token"`
        }).end();
        return;
      }
      const body = await readBody(request);
      const message = JSON.parse(body) as { id?: number | string; method?: string; params?: Json };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: (message.params?.protocolVersion as string) ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture-mcp", version: "1.0.0" }
          }
        }, { "mcp-session-id": `sess-${randomUUID()}` });
        return;
      }
      if (message.method === "tools/list") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              { name: "echo", description: "echoes", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
              { name: "admin_action", description: "needs a scope", inputSchema: { type: "object", properties: {} } }
            ]
          }
        });
        return;
      }
      if (message.method === "tools/call") {
        const toolName = String(message.params?.name ?? "");
        if (options.protectedToolScope && toolName === "admin_action" && (counters.accessTokenScopes.get(token) ?? "").split(/\s+/).includes(options.protectedToolScope) === false) {
          response.writeHead(403, {
            "www-authenticate": `Bearer error="insufficient_scope", scope="${options.protectedToolScope}", resource_metadata="${protectedResourceMetadataUrl.value}"`
          }).end();
          return;
        }
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: `echo:${String((message.params?.arguments as Json | undefined)?.text ?? "")}` }] }
        });
        return;
      }
      sendJson(response, 200, { jsonrpc: "2.0", id: message.id, result: {} });
    })().catch((error) => response.writeHead(500).end(String(error)));
  });

  asPort = await listen(asServer);
  asUrl = `http://127.0.0.1:${asPort}`;
  overrideMetadataUrl = options.overrideMetadataIssuer || options.hideDiscovery ? `${asUrl}/override-metadata` : undefined;
  const mcpPort = await listen(mcpServer);
  mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
  protectedResourceMetadataUrl.value = `http://127.0.0.1:${mcpPort}/.well-known/oauth-protected-resource`;

  return {
    asUrl,
    mcpUrl,
    protectedResourceMetadataUrl: protectedResourceMetadataUrl.value,
    overrideMetadataUrl,
    validAccessTokens: counters.validAccessTokens,
    accessTokenScopes: counters.accessTokenScopes,
    refreshTokens: counters.refreshTokens,
    metadataFetches: counters.metadataFetches,
    get refreshCalls() { return counters.refreshCalls; },
    get tokenExchangeSucceeded() { return counters.tokenExchangeSucceeded; },
    get lastAuthorizationParams() { return counters.lastAuthorizationParams; },
    revokeAccessTokens: () => counters.validAccessTokens.clear(),
    close: async () => {
      await Promise.all([closeServer(asServer), closeServer(mcpServer)]);
    }
  };
}

function oauthServer(id: string, url: string, overrides: Partial<McpOAuthConfig> = {}): McpServerConfig {
  return {
    id,
    name: id,
    enabled: true,
    transport: "http",
    stdio: { command: "", args: [], env: {}, cwd: "" },
    http: { url, headers: {} },
    auth: { mode: "oauth", oauth: { authServerMetadataUrl: "", clientName: "Molibot", ...overrides } },
    toolNamePrefix: ""
  };
}

function tempManager(): { manager: McpOAuthManager; store: McpOAuthStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-oauth-e2e-"));
  const store = new McpOAuthStore(mcpOAuthStorePath(directory));
  const manager = new McpOAuthManager({ store });
  return { manager, store, directory };
}

/** Simulate the browser: follow the redirect to the loopback callback. */
async function completeBrowser(authorizationUrl: string): Promise<void> {
  const redirect = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const location = redirect.headers.get("location");
  assert.ok(location, "authorization endpoint must redirect to the callback");
  const callback = await fetch(location);
  assert.equal(callback.status, 200);
}

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

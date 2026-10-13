import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpOAuthConfig, McpServerConfig } from "$lib/server/settings/schema.js";
import { McpOAuthManager } from "$lib/server/agent/mcp/oauth.js";
import { McpOAuthStore, mcpOAuthStorePath } from "$lib/server/agent/mcp/oauthStore.js";

/**
 * End-to-end MCP OAuth against a local, in-process authorization server and a
 * local Streamable HTTP MCP resource. Every protocol step Molibot delegates to
 * Pi is exercised for real — discovery, dynamic client registration, PKCE S256,
 * `state` echo, RFC 9207 `iss`, refresh, and step-up scopes — so the integration
 * is validated by observable HTTP behaviour, not by re-asserting adapter shapes.
 */

type Json = Record<string, unknown>;

export interface FixtureOptions {
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
  beforeTokenExchange?: () => Promise<void>;
}

export interface Fixture {
  asUrl: string;
  mcpUrl: string;
  protectedResourceMetadataUrl: string;
  overrideMetadataUrl?: string;
  /** Access tokens the resource currently accepts. */
  validAccessTokens: Set<string>;
  accessTokenScopes: Map<string, string>;
  refreshTokens: Set<string>;
  refreshCalls: number;
  challenges: number;
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

export async function startFixture(options: FixtureOptions = {}): Promise<Fixture> {
  // Live counters shared with the request handlers; the returned fixture exposes
  // them through getters so tests observe mutations, not a snapshot.
  const counters = {
    validAccessTokens: new Set<string>(),
    accessTokenScopes: new Map<string, string>(),
    refreshTokens: new Set<string>(),
    refreshCalls: 0,
    challenges: 0,
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
          await options.beforeTokenExchange?.();
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
          counters.challenges++;
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
    get challenges() { return counters.challenges; },
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

export function oauthServer(id: string, url: string, overrides: Partial<McpOAuthConfig> = {}): McpServerConfig {
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

export function tempManager(): { manager: McpOAuthManager; store: McpOAuthStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "molibot-mcp-oauth-e2e-"));
  const store = new McpOAuthStore(mcpOAuthStorePath(directory));
  const manager = new McpOAuthManager({ store });
  return { manager, store, directory };
}

/** Simulate the browser: follow the redirect to the loopback callback. */
export async function completeBrowser(authorizationUrl: string): Promise<void> {
  const redirect = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const location = redirect.headers.get("location");
  assert.ok(location, "authorization endpoint must redirect to the callback");
  const callback = await fetch(location);
  assert.equal(callback.status, 200);
}

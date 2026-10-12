import { randomUUID } from "node:crypto";
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthProvider,
  OAuthCallbackServer
} from "@earendil-works/pi-mcp/oauth";
import type { AuthProvider } from "@earendil-works/pi-mcp";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { McpOAuthStore, type McpOAuthScope } from "./oauthStore.js";

export type McpAuthState = "not_applicable" | "unauthorized" | "authorizing" | "authorized" | "expired" | "error";

/** Never carries a token: settings responses, logs and the UI read this shape only. */
export interface McpAuthStatus {
  mode: "headers" | "oauth";
  state: McpAuthState;
  expiresAt?: number;
  error?: string;
}

export interface McpLoginSession {
  id: string;
  serverId: string;
  authorizationUrl: string;
  createdAt: number;
}

interface PendingLogin {
  session: McpLoginSession;
  serverId: string;
  status: "authorizing" | "authorized" | "error";
  error?: string;
  task: Promise<void>;
  callback: OAuthCallbackServer;
}

export interface McpOAuthManagerOptions {
  store: McpOAuthStore;
  /** Test seam: how a loopback callback listener is created. */
  listenCallback?: () => Promise<OAuthCallbackServer>;
}

function isOAuth(server: McpServerConfig): boolean {
  return server.transport === "http" && server.auth?.mode === "oauth";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scope to request: the union of what was already granted and what the server
 * advertises. Re-authorizing with only the advertised default would silently
 * drop scopes a step-up granted earlier, so anything already held is kept.
 * Empty means "let the flow pick its default", not "request nothing".
 */
function unionScope(granted: string | undefined, advertised: readonly string[] | undefined): string | undefined {
  const scopes = new Set<string>();
  for (const value of [granted, ...(advertised ?? [])]) {
    for (const token of (value ?? "").split(/\s+/)) if (token) scopes.add(token);
  }
  return scopes.size ? [...scopes].join(" ") : undefined;
}

/**
 * Owner-scoped MCP OAuth operations over Pi's public OAuth client.
 *
 * The manager owns no protocol logic: discovery, PKCE, state, RFC 9207 issuer
 * validation, token refresh, step-up scopes and dynamic client registration all
 * stay in `@earendil-works/pi-mcp/oauth`. It decides only *what* to authorize
 * (per server identity and URL) and keeps raw credentials out of every response.
 */
export class McpOAuthManager {
  private readonly pending = new Map<string, PendingLogin>();

  constructor(private readonly options: McpOAuthManagerOptions) {}

  scopeFor(server: McpServerConfig): McpOAuthScope {
    return { serverId: server.id, url: server.http.url, authServerMetadataUrl: server.auth?.oauth.authServerMetadataUrl ?? "" };
  }

  private createProvider(server: McpServerConfig, redirectUrl: string, onRedirect: (url: URL) => void): McpOAuthProvider {
    return new McpOAuthProvider({
      serverUrl: server.http.url,
      redirectUrl,
      clientMetadata: { client_name: server.auth?.oauth.clientName?.trim() || "Molibot" },
      store: this.options.store.forScope(this.scopeFor(server)),
      onRedirect
    });
  }

  /** Current authorization state for one server. Never loads a token into the result. */
  authStatus(server: McpServerConfig): McpAuthStatus {
    if (!isOAuth(server)) return { mode: "headers", state: "not_applicable" };
    const login = this.loginFor(server.id);
    if (login?.status === "authorizing") return { mode: "oauth", state: "authorizing" };
    if (login?.status === "error") return { mode: "oauth", state: "error", error: login.error };
    const state = this.options.store.forScope(this.scopeFor(server)).load();
    if (!state?.tokens) return { mode: "oauth", state: "unauthorized" };
    const expiresAt = state.tokensExpireAt;
    if (expiresAt !== undefined && expiresAt <= Date.now()) return { mode: "oauth", state: "expired", expiresAt };
    return { mode: "oauth", state: "authorized", expiresAt };
  }

  private loginFor(serverId: string): PendingLogin | undefined {
    for (const login of this.pending.values()) if (login.serverId === serverId) return login;
    return undefined;
  }

  /** Auth provider for the HTTP transport; refreshes tokens and reports step-up needs through Pi. */
  authProvider(server: McpServerConfig): AuthProvider {
    return adaptOAuthProvider(this.createProvider(server, "http://127.0.0.1/callback", () => undefined));
  }

  /**
   * Start an authorization. Resolves once the browser redirect URL is ready; the
   * callback and code exchange continue in the background. Only a user-initiated
   * call reaches here — an unattended run never opens a browser.
   */
  async beginLogin(server: McpServerConfig, options: { force?: boolean } = {}): Promise<{ session: McpLoginSession; task: Promise<void> }> {
    if (!isOAuth(server)) throw new Error(`MCP server "${server.id}" is not configured for OAuth.`);
    // A second login for the same server replaces the first; the old callback is closed.
    for (const [id, login] of this.pending) if (login.serverId === server.id) { await this.dropLogin(id); }
    const callback = await (this.options.listenCallback ?? (() => OAuthCallbackServer.listen()))();
    let authorizationUrl: URL | undefined;
    const provider = this.createProvider(server, callback.redirectUrl, (url) => { authorizationUrl = url; });
    // The configured metadata document must survive the code exchange too: re-deriving
    // it from discovery can reach a different authorization server (or none at all).
    const metadataOption = server.auth?.oauth.authServerMetadataUrl
      ? { authorizationServerMetadataUrl: new URL(server.auth.oauth.authServerMetadataUrl) }
      : {};
    // Preserve scopes granted by an earlier login (for example a step-up) while
    // still requesting the server's advertised defaults.
    const scope = unionScope(
      this.options.store.forScope(this.scopeFor(server)).load()?.tokens?.scope,
      (await provider.discoveryState())?.resourceMetadata?.scopes_supported
    );
    const scopeOption = scope ? { scope } : {};
    try {
      const result = await authorizeMcp(provider, {
        serverUrl: server.http.url,
        ...metadataOption,
        ...scopeOption,
        skipRefresh: options.force ?? true
      });
      if (result === "AUTHORIZED") {
        await callback.close();
        const session: McpLoginSession = { id: randomUUID(), serverId: server.id, authorizationUrl: "", createdAt: Date.now() };
        return { session, task: Promise.resolve() };
      }
      if (!authorizationUrl) throw new Error("The authorization server did not return a redirect URL.");
      const state = await provider.state();
      const session: McpLoginSession = { id: randomUUID(), serverId: server.id, authorizationUrl: authorizationUrl.toString(), createdAt: Date.now() };
      const entry: PendingLogin = { session, serverId: server.id, status: "authorizing", callback, task: Promise.resolve() };
      entry.task = (async () => {
        try {
          const callbackResult = await callback.waitForCallback(state);
          await authorizeMcp(provider, { serverUrl: server.http.url, ...metadataOption, ...scopeOption, authorizationCode: callbackResult.code, iss: callbackResult.iss });
          entry.status = "authorized";
          // Tokens are now the source of truth; a settled attempt must not linger and
          // shadow later logout or delete decisions.
          this.pending.delete(session.id);
        } catch (error) {
          entry.status = "error";
          entry.error = errorText(error);
        } finally {
          try { await callback.close(); } catch { /* the callback may already be closed */ }
        }
      })();
      this.pending.set(session.id, entry);
      return { session, task: entry.task };
    } catch (error) {
      try { await callback.close(); } catch { /* ignore */ }
      throw error;
    }
  }

  /** Cancel an in-flight authorization so the UI never waits on a dead attempt. */
  async closeLogin(id: string): Promise<void> {
    const login = this.pending.get(id);
    if (!login) return;
    login.status = "error";
    login.error = "Authorization was cancelled.";
    try { await login.callback.close(); } catch { /* ignore */ }
  }

  /** Cancel an attempt and forget it, so it cannot shadow a later logout or delete. */
  private async dropLogin(id: string): Promise<void> {
    const login = this.pending.get(id);
    if (!login) return;
    await this.closeLogin(id);
    this.pending.delete(id);
  }

  /** Drop this server's credentials and any in-flight attempt; other servers are untouched. */
  async logout(server: McpServerConfig): Promise<void> {
    if (!isOAuth(server)) return;
    for (const [id, login] of [...this.pending]) if (login.serverId === server.id) await this.dropLogin(id);
    this.options.store.remove(this.scopeFor(server));
  }

  /** Called when a server is deleted: clear this server's OAuth records only. */
  forgetServer(serverId: string): void {
    for (const [id, login] of [...this.pending]) if (login.serverId === serverId) void this.dropLogin(id);
    this.options.store.removeServer(serverId);
  }
}

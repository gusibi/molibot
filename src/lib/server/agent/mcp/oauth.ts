import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthProvider,
  McpOAuthAuthorizationRequiredError,
  OAuthCallbackServer,
  parseWwwAuthenticate
} from "@earendil-works/pi-mcp/oauth";
import type { AuthProvider } from "@earendil-works/pi-mcp";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { McpOAuthStore, type McpOAuthScope } from "./oauthStore.js";

const callContext = new AsyncLocalStorage<{ signal?: AbortSignal; interactive: boolean; replaySafe: boolean }>();

/** Interactive calls retain their owner while waiting; only safe reads retry. */
export function withMcpOAuthCall<T>(context: { signal?: AbortSignal; interactive: boolean; replaySafe: boolean }, work: () => Promise<T>): Promise<T> {
  return callContext.run(context, work);
}

/** Authorization waits share the transport's effective cancellation and absolute deadline. */
export function withMcpOAuthSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const call = callContext.getStore();
  return call ? callContext.run({ ...call, signal }, work) : work();
}

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
  private readonly callbacks = new Map<string, string>();
  private readonly revisions = new Map<string, number>();
  private readonly requiredScopes = new Map<string, string>();
  private readonly providers = new Map<string, AuthProvider>();
  private readonly loginQueue = new Map<string, Promise<unknown>>();
  private readonly waiters = new Set<{ serverId: string; resolve(): void; reject(error: Error): void }>();

  constructor(private readonly options: McpOAuthManagerOptions) {}

  scopeFor(server: McpServerConfig): McpOAuthScope {
    return { serverId: server.id, url: server.http.url, authServerMetadataUrl: server.auth?.oauth.authServerMetadataUrl ?? "" };
  }

  private createProvider(server: McpServerConfig, redirectUrl: string, onRedirect: (url: URL) => void, revision = this.revisions.get(server.id) ?? 0): McpOAuthProvider {
    const store = this.options.store.forScope(this.scopeFor(server));
    const assertCurrent = () => { if ((this.revisions.get(server.id) ?? 0) !== revision) throw new Error("This OAuth attempt was cancelled or replaced."); };
    return new McpOAuthProvider({
      serverUrl: server.http.url,
      redirectUrl,
      clientMetadata: { client_name: server.auth?.oauth.clientName?.trim() || "Molibot" },
      store: { load: () => { assertCurrent(); return store.load(); }, save: state => { assertCurrent(); store.save(state); } },
      onRedirect
    });
  }

  /** Current authorization state for one server. Never loads a token into the result. */
  authStatus(server: McpServerConfig): McpAuthStatus {
    if (!isOAuth(server)) return { mode: "headers", state: "not_applicable" };
    const login = this.loginFor(server.id);
    if (login?.status === "authorizing") return { mode: "oauth", state: "authorizing" };
    if (login?.status === "error") return { mode: "oauth", state: "error", error: login.error };
    const required = this.requiredScopes.get(server.id);
    if (required) return { mode: "oauth", state: "error", error: `Additional authorization required: ${required}. Re-authorize this server in MCP settings; the current safe request is paused.` };
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
    const key = JSON.stringify([this.scopeFor(server), this.revisions.get(server.id) ?? 0]);
    const cached = this.providers.get(key);
    if (cached) return cached;
    const base = adaptOAuthProvider(this.createProvider(server, "http://127.0.0.1/callback", () => undefined));
    const revision = this.revisions.get(server.id) ?? 0;
    const provider: AuthProvider = { token: async () => this.options.store.forScope(this.scopeFor(server)).load()?.tokens?.access_token, onUnauthorized: async context => {
      if (revision !== (this.revisions.get(server.id) ?? 0)) return this.authProvider(server).onUnauthorized?.(context);
      const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
      if (challenge.scope) this.requiredScopes.set(server.id, unionScope(this.requiredScopes.get(server.id), [challenge.scope])!);
      try { await base.onUnauthorized?.(context); }
      catch (error) {
        const call = callContext.getStore();
        if (!(error instanceof McpOAuthAuthorizationRequiredError) || !call?.interactive) throw error;
        await this.waitForAuthorization(server, call.signal);
        call.signal?.throwIfAborted();
        if (!call.replaySafe) throw new Error("MCP authorization completed. The original operation was not replayed because its external result may be unknown; check the result before requesting it again.");
      }
    } };
    this.providers.set(key, provider);
    return provider;
  }

  /**
   * Start an authorization. Resolves once the browser redirect URL is ready; the
   * callback and code exchange continue in the background. Only a user-initiated
   * call reaches here — an unattended run never opens a browser.
   */
  async beginLogin(server: McpServerConfig, options: { force?: boolean; callbackOrigin?: string } = {}): Promise<{ session: McpLoginSession; task: Promise<void> }> {
    const revision = (this.revisions.get(server.id) ?? 0) + 1;
    this.revisions.set(server.id, revision);
    const previous = this.loginQueue.get(server.id) ?? Promise.resolve();
    const started = previous.catch(() => undefined).then(() => this.startLogin(server, options, revision));
    this.loginQueue.set(server.id, started);
    try { return await started; }
    finally { if (this.loginQueue.get(server.id) === started) this.loginQueue.delete(server.id); }
  }

  private async startLogin(server: McpServerConfig, options: { force?: boolean; callbackOrigin?: string }, revision: number): Promise<{ session: McpLoginSession; task: Promise<void> }> {
    const assertCurrent = () => { if ((this.revisions.get(server.id) ?? 0) !== revision) throw new Error("This OAuth attempt was cancelled or replaced."); };
    assertCurrent();
    if (!isOAuth(server)) throw new Error(`MCP server "${server.id}" is not configured for OAuth.`);
    // A second login for the same server replaces the first; the old callback is closed.
    for (const [id, login] of this.pending) if (login.serverId === server.id) { await this.dropLogin(id); }
    this.providers.clear();
    const attemptId = randomUUID();
    let callbackOrigin: URL | undefined;
    if (options.callbackOrigin) {
      callbackOrigin = new URL(options.callbackOrigin);
      if (callbackOrigin.protocol !== "https:" && !(callbackOrigin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(callbackOrigin.hostname))) throw new Error("OAuth Web callbacks require HTTPS except on loopback.");
    }
    const callback = await (this.options.listenCallback ?? (() => OAuthCallbackServer.listen()))();
    let authorizationUrl: URL | undefined;
    const redirectUrl = callbackOrigin ? new URL(`/api/mcp/oauth/callback/${attemptId}`, callbackOrigin.origin).toString() : callback.redirectUrl;
    if (callbackOrigin) this.callbacks.set(attemptId, callback.redirectUrl);
    const provider = this.createProvider(server, redirectUrl, (url) => { authorizationUrl = url; }, revision);
    // The configured metadata document must survive the code exchange too: re-deriving
    // it from discovery can reach a different authorization server (or none at all).
    const metadataOption = server.auth?.oauth.authServerMetadataUrl
      ? { authorizationServerMetadataUrl: new URL(server.auth.oauth.authServerMetadataUrl) }
      : {};
    // Preserve scopes granted by an earlier login (for example a step-up) while
    // still requesting the server's advertised defaults.
    const scope = unionScope(
      this.options.store.forScope(this.scopeFor(server)).load()?.tokens?.scope,
      [...(await provider.discoveryState())?.resourceMetadata?.scopes_supported ?? [], this.requiredScopes.get(server.id) ?? ""]
    );
    const scopeOption = scope ? { scope } : {};
    try {
      assertCurrent();
      const result = await authorizeMcp(provider, {
        serverUrl: server.http.url,
        ...metadataOption,
        ...scopeOption,
        skipRefresh: options.force ?? true
      });
      assertCurrent();
      if (result === "AUTHORIZED") {
        this.callbacks.delete(attemptId);
        await callback.close();
        const session: McpLoginSession = { id: attemptId, serverId: server.id, authorizationUrl: "", createdAt: Date.now() };
        return { session, task: Promise.resolve() };
      }
      if (!authorizationUrl) throw new Error("The authorization server did not return a redirect URL.");
      const state = await provider.state();
      const session: McpLoginSession = { id: attemptId, serverId: server.id, authorizationUrl: authorizationUrl.toString(), createdAt: Date.now() };
      const entry: PendingLogin = { session, serverId: server.id, status: "authorizing", callback, task: Promise.resolve() };
      entry.task = (async () => {
        try {
          const callbackResult = await callback.waitForCallback(state);
          await authorizeMcp(provider, { serverUrl: server.http.url, ...metadataOption, ...scopeOption, authorizationCode: callbackResult.code, iss: callbackResult.iss });
          const required = this.requiredScopes.get(server.id);
          const granted = new Set((this.options.store.forScope(this.scopeFor(server)).load()?.tokens?.scope ?? "").split(/\s+/));
          if (required && required.split(/\s+/).some(scope => !granted.has(scope))) throw new Error("The authorization server did not grant the requested scopes.");
          this.requiredScopes.delete(server.id);
          entry.status = "authorized";
          for (const waiter of [...this.waiters]) if (waiter.serverId === server.id) waiter.resolve();
          // Tokens are now the source of truth; a settled attempt must not linger and
          // shadow later logout or delete decisions.
          this.pending.delete(session.id);
        } catch (error) {
          entry.status = "error";
          entry.error = errorText(error);
        } finally {
          this.callbacks.delete(attemptId);
          try { await callback.close(); } catch { /* the callback may already be closed */ }
        }
      })();
      this.pending.set(session.id, entry);
      return { session, task: entry.task };
    } catch (error) {
      this.callbacks.delete(attemptId);
      try { await callback.close(); } catch { /* ignore */ }
      throw error;
    }
  }

  private waitForAuthorization(server: McpServerConfig, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.waiters.delete(waiter); signal?.removeEventListener("abort", abort); };
      const waiter = { serverId: server.id, resolve: () => { cleanup(); resolve(); }, reject: (error: Error) => { cleanup(); reject(error); } };
      const abort = () => waiter.reject(new Error("The owning execution stopped while awaiting authorization."));
      this.waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /** Relay a deployment callback to Pi's state/issuer validator; no browser cookie is required. */
  async forwardCallback(id: string, incoming: URL): Promise<Response> {
    const local = this.callbacks.get(id);
    if (!local) return new Response("Authorization attempt expired or already completed.", { status: 410 });
    const target = new URL(local);
    target.search = incoming.search;
    const response = await fetch(target, { redirect: "error" });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  /** Cancel an in-flight authorization so the UI never waits on a dead attempt. */
  async closeLogin(id: string): Promise<void> {
    const login = this.pending.get(id);
    if (!login) return;
    this.revisions.set(login.serverId, (this.revisions.get(login.serverId) ?? 0) + 1);
    this.providers.clear();
    this.callbacks.delete(id);
    for (const waiter of [...this.waiters]) if (waiter.serverId === login.serverId) waiter.reject(new Error("Authorization was cancelled."));
    login.status = "error";
    login.error = "Authorization was cancelled.";
    try { await login.callback.close(); } catch { /* ignore */ }
  }

  /** Cancel an attempt and forget it, so it cannot shadow a later logout or delete. */
  private async dropLogin(id: string): Promise<void> {
    const login = this.pending.get(id);
    if (!login) return;
    this.callbacks.delete(id);
    login.status = "error";
    login.error = "Authorization was replaced.";
    try { await login.callback.close(); } catch { /* already closed */ }
    this.pending.delete(id);
  }

  /** Drop this server's credentials and any in-flight attempt; other servers are untouched. */
  async logout(server: McpServerConfig): Promise<void> {
    if (!isOAuth(server)) return;
    this.revisions.set(server.id, (this.revisions.get(server.id) ?? 0) + 1);
    this.providers.clear();
    this.requiredScopes.delete(server.id);
    for (const waiter of [...this.waiters]) if (waiter.serverId === server.id) waiter.reject(new Error("The MCP server was signed out."));
    for (const [id, login] of [...this.pending]) if (login.serverId === server.id) await this.dropLogin(id);
    this.options.store.remove(this.scopeFor(server));
  }

  /** Called when a server is deleted: clear this server's OAuth records only. */
  forgetServer(serverId: string): void {
    this.revisions.set(serverId, (this.revisions.get(serverId) ?? 0) + 1);
    this.providers.clear();
    this.requiredScopes.delete(serverId);
    for (const waiter of [...this.waiters]) if (waiter.serverId === serverId) waiter.reject(new Error("The MCP server was deleted."));
    for (const [id, login] of [...this.pending]) if (login.serverId === serverId) void this.dropLogin(id);
    this.options.store.removeServer(serverId);
  }
}

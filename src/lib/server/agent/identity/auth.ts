import { randomUUID } from "node:crypto";
import type {
  ApiKeyCredential,
  AuthCheck,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential,
  CredentialStore,
  OAuthCredential,
  Provider
} from "@earendil-works/pi-ai";
import { getPiModels } from "$lib/server/providers/piRuntime.js";
import { FileCredentialStore, type CredentialData } from "$lib/server/agent/identity/credentialStore.js";
import { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";

export { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";

export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthData = CredentialData;

export type OAuthLoginState =
  | "pending"
  | "awaiting_input"
  | "waiting_external"
  | "done"
  | "failed"
  | "cancelled"
  | "expired";

export interface OAuthLoginPromptOption {
  id: string;
  label: string;
  description?: string;
}

export interface OAuthLoginPromptView {
  id: string;
  type: AuthPrompt["type"];
  message: string;
  placeholder?: string;
  options?: OAuthLoginPromptOption[];
}

export interface OAuthLoginMessageView {
  id: number;
  type: "info" | "progress";
  message: string;
  links?: Array<{ url: string; label?: string }>;
}

export interface OAuthLoginSnapshot {
  id: string;
  providerId: string;
  state: OAuthLoginState;
  revision: number;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  prompt: OAuthLoginPromptView | null;
  authUrl?: { url: string; instructions?: string };
  deviceCode?: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresAt?: number;
  };
  messages: OAuthLoginMessageView[];
  error?: string;
}

export interface OAuthProviderAuthView {
  id: string;
  name: string;
  loginLabel: string;
  credential?: {
    type: Credential["type"];
    expiresAt?: number;
  };
  effectiveAuth?: AuthCheck;
  /**
   * A saved API-key override shadows this provider's stored credential.
   *
   * pi resolves `overrides.apiKey` before it ever reads the credential store
   * (`resolveProviderAuth` in pi-ai), so a non-empty key saved in settings wins
   * over a freshly completed OAuth login — the login succeeds and then every
   * request still goes out with the key. The UI has to say so, because nothing
   * else about it is visible.
   */
  apiKeyOverride?: boolean;
}

export interface ListProvidersOptions {
  /** Provider ids that have a non-empty API-key override saved in settings. */
  apiKeyOverrides?: ReadonlySet<string>;
}

interface OAuthModels {
  getProviders(): readonly Provider[];
  getProvider(providerId: string): Provider | undefined;
  checkAuth(providerId: string): Promise<AuthCheck | undefined>;
  login(providerId: string, type: "oauth", interaction: AuthInteraction): Promise<Credential>;
  logout(providerId: string): Promise<void>;
}

interface PendingPrompt {
  id: string;
  type: AuthPrompt["type"];
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  detach: () => void;
}

interface LoginSession {
  id: string;
  providerId: string;
  state: OAuthLoginState;
  revision: number;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  prompt: OAuthLoginPromptView | null;
  pendingPrompt?: PendingPrompt;
  authUrl?: OAuthLoginSnapshot["authUrl"];
  deviceCode?: OAuthLoginSnapshot["deviceCode"];
  messages: OAuthLoginMessageView[];
  error?: string;
  abortController: AbortController;
  cancelReason?: "cancelled" | "expired";
  logoutRequested: boolean;
  settled: boolean;
  completion: Promise<void>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  retentionTimer?: ReturnType<typeof setTimeout>;
}

export type OAuthLoginErrorCode =
  | "unsupported_provider"
  | "provider_busy"
  | "session_not_found"
  | "session_finished"
  | "prompt_not_pending"
  | "stale_prompt"
  | "invalid_answer";

export class OAuthLoginError extends Error {
  constructor(readonly code: OAuthLoginErrorCode, message: string) {
    super(message);
    this.name = "OAuthLoginError";
  }
}

export interface OAuthLoginManagerOptions {
  models?: OAuthModels;
  credentials?: CredentialStore;
  now?: () => number;
  createId?: () => string;
  activeTtlMs?: number;
  terminalRetentionMs?: number;
}

const DEFAULT_ACTIVE_TTL_MS = 20 * 60 * 1000;
const DEFAULT_TERMINAL_RETENTION_MS = 3 * 60 * 1000;
const MAX_MESSAGES = 40;

function isTerminal(state: OAuthLoginState): boolean {
  return state === "done" || state === "failed" || state === "cancelled" || state === "expired";
}

function clonePrompt(prompt: AuthPrompt, id: string): OAuthLoginPromptView {
  if (prompt.type === "select") {
    return {
      id,
      type: prompt.type,
      message: prompt.message,
      options: prompt.options.map((option) => ({ ...option }))
    };
  }
  return {
    id,
    type: prompt.type,
    message: prompt.message,
    placeholder: prompt.placeholder
  };
}

/**
 * Strip anything credential-shaped out of a provider error before it can reach a
 * response body or the log. Shared with the connectivity check, which surfaces
 * raw provider errors for the same providers.
 */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/([?&](?:api_?key|client_secret|code|state|token|access_token|refresh_token|device_code)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/("(?:api_?key|client_secret|access_token|refresh_token|device_code|code|token)"\s*:\s*")[^"]+("?)/gi, "$1<redacted>$2")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "<redacted-token>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted-token>")
    .slice(0, 600);
}

function timerUnref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

export class OAuthLoginManager {
  private readonly models: OAuthModels;
  private readonly credentials: CredentialStore;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly activeTtlMs: number;
  private readonly terminalRetentionMs: number;
  private readonly sessions = new Map<string, LoginSession>();
  private readonly activeByProvider = new Map<string, string>();

  constructor(options: OAuthLoginManagerOptions = {}) {
    this.models = options.models ?? getPiModels();
    this.credentials = options.credentials ?? new FileCredentialStore(resolveAuthFilePath());
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.activeTtlMs = options.activeTtlMs ?? DEFAULT_ACTIVE_TTL_MS;
    this.terminalRetentionMs = options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
  }

  listOAuthProviderIds(): string[] {
    return this.models.getProviders()
      .filter((provider) => Boolean(provider.auth.oauth))
      .map((provider) => provider.id)
      .sort();
  }

  async listProviders(options: ListProvidersOptions = {}): Promise<OAuthProviderAuthView[]> {
    const providers = this.models.getProviders().filter((provider) => Boolean(provider.auth.oauth));
    return Promise.all(providers.map(async (provider) => {
      const credential = await this.credentials.read(provider.id);
      const effectiveAuth = await this.models.checkAuth(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        loginLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name ?? `Sign in to ${provider.name}`,
        credential: credential
          ? {
              type: credential.type,
              expiresAt: credential.type === "oauth" ? credential.expires : undefined
            }
          : undefined,
        effectiveAuth,
        apiKeyOverride: options.apiKeyOverrides?.has(provider.id) ? true : undefined
      };
    })).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
  }

  start(providerId: string): OAuthLoginSnapshot {
    const normalized = providerId.trim();
    const provider = this.models.getProvider(normalized);
    if (!provider?.auth.oauth) {
      throw new OAuthLoginError(
        "unsupported_provider",
        `Unsupported OAuth provider '${providerId}'.`
      );
    }

    const activeId = this.activeByProvider.get(normalized);
    const active = activeId ? this.sessions.get(activeId) : undefined;
    if (active && !active.settled) {
      throw new OAuthLoginError(
        "provider_busy",
        `A login for '${normalized}' is already in progress.`
      );
    }

    const now = this.now();
    const session: LoginSession = {
      id: this.createId(),
      providerId: normalized,
      state: "pending",
      revision: 1,
      startedAt: now,
      updatedAt: now,
      expiresAt: now + this.activeTtlMs,
      prompt: null,
      messages: [],
      abortController: new AbortController(),
      logoutRequested: false,
      settled: false,
      completion: Promise.resolve()
    };
    this.sessions.set(session.id, session);
    this.activeByProvider.set(normalized, session.id);
    this.scheduleExpiry(session);
    session.completion = this.run(session);
    return this.snapshot(session);
  }

  get(sessionId: string): OAuthLoginSnapshot {
    const session = this.requireSession(sessionId);
    return this.snapshot(session);
  }

  answer(sessionId: string, promptId: string, value: string): OAuthLoginSnapshot {
    const session = this.requireSession(sessionId);
    if (isTerminal(session.state)) {
      throw new OAuthLoginError("session_finished", "This login session has already finished.");
    }
    const pending = session.pendingPrompt;
    if (!pending || !session.prompt) {
      throw new OAuthLoginError("prompt_not_pending", "This login session is not waiting for input.");
    }
    if (pending.id !== promptId) {
      throw new OAuthLoginError("stale_prompt", "That answer belongs to an earlier login step.");
    }

    const answer = value.trim();
    if (pending.type === "select") {
      const valid = session.prompt.options?.some((option) => option.id === answer);
      if (!valid) throw new OAuthLoginError("invalid_answer", "Select one of the available options.");
    } else if (pending.type !== "text" && !answer) {
      throw new OAuthLoginError("invalid_answer", "A value is required for this login step.");
    }

    pending.detach();
    session.pendingPrompt = undefined;
    session.prompt = null;
    this.change(session, session.authUrl || session.deviceCode ? "waiting_external" : "pending");
    pending.resolve(answer);
    return this.snapshot(session);
  }

  cancel(sessionId: string): OAuthLoginSnapshot {
    const session = this.requireSession(sessionId);
    if (isTerminal(session.state)) return this.snapshot(session);
    this.stop(session, "cancelled");
    return this.snapshot(session);
  }

  async logout(providerId: string): Promise<boolean> {
    const normalized = providerId.trim();
    const activeId = this.activeByProvider.get(normalized);
    const active = activeId ? this.sessions.get(activeId) : undefined;
    if (active && !active.settled) {
      active.logoutRequested = true;
      if (!isTerminal(active.state)) this.stop(active, "cancelled");
    }
    const existed = Boolean(await this.credentials.read(normalized));
    await this.models.logout(normalized);
    return existed;
  }

  private async run(session: LoginSession): Promise<void> {
    let previousCredential: Credential | undefined;
    let previousCredentialLoaded = false;
    try {
      previousCredential = await this.credentials.read(session.providerId);
      previousCredentialLoaded = true;
      await this.models.login(session.providerId, "oauth", {
        signal: session.abortController.signal,
        notify: (event) => this.onEvent(session, event),
        prompt: (prompt) => this.onPrompt(session, prompt)
      });
      if (session.cancelReason || session.logoutRequested) {
        if (!isTerminal(session.state)) this.change(session, session.cancelReason ?? "cancelled");
      } else {
        this.change(session, "done");
      }
    } catch (error) {
      if (session.cancelReason) {
        if (!isTerminal(session.state)) this.change(session, session.cancelReason);
      } else {
        session.error = safeErrorMessage(error);
        this.change(session, "failed");
      }
    } finally {
      try {
        if (session.logoutRequested) {
          await this.models.logout(session.providerId);
        } else if (session.cancelReason && previousCredentialLoaded) {
          await this.restoreCredential(session.providerId, previousCredential);
        }
      } catch (error) {
        session.error = safeErrorMessage(error);
        this.change(session, "failed");
      }
      session.settled = true;
      session.pendingPrompt?.detach();
      session.pendingPrompt = undefined;
      session.prompt = null;
      if (this.activeByProvider.get(session.providerId) === session.id) {
        this.activeByProvider.delete(session.providerId);
      }
      this.scheduleRetention(session);
    }
  }

  private async restoreCredential(providerId: string, credential: Credential | undefined): Promise<void> {
    if (!credential) {
      await this.credentials.delete(providerId);
      return;
    }
    await this.credentials.modify(providerId, async () => credential);
  }

  private onEvent(session: LoginSession, event: AuthEvent): void {
    if (isTerminal(session.state)) return;
    if (event.type === "auth_url") {
      session.authUrl = { url: event.url, instructions: event.instructions };
      this.change(session, session.prompt ? "awaiting_input" : "waiting_external");
      return;
    }
    if (event.type === "device_code") {
      const expiresAt = event.expiresInSeconds
        ? this.now() + event.expiresInSeconds * 1000
        : undefined;
      session.deviceCode = {
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresAt
      };
      if (expiresAt && expiresAt > session.expiresAt) {
        session.expiresAt = expiresAt;
        this.scheduleExpiry(session);
      }
      this.change(session, session.prompt ? "awaiting_input" : "waiting_external");
      return;
    }

    const message = event.message.trim();
    if (!message) return;
    const row: OAuthLoginMessageView = {
      id: session.revision + 1,
      type: event.type,
      message,
      links: event.type === "info" ? event.links?.map((link) => ({ ...link })) : undefined
    };
    session.messages = [...session.messages.slice(-(MAX_MESSAGES - 1)), row];
    this.change(session, session.state);
  }

  private onPrompt(session: LoginSession, prompt: AuthPrompt): Promise<string> {
    if (session.cancelReason || session.abortController.signal.aborted) {
      return Promise.reject(new Error("Login cancelled"));
    }
    if (session.pendingPrompt) {
      return Promise.reject(new Error("Provider emitted overlapping login prompts"));
    }

    const promptId = this.createId();
    session.prompt = clonePrompt(prompt, promptId);
    this.change(session, "awaiting_input");
    return new Promise<string>((resolve, reject) => {
      let detached = false;
      const onPromptAbort = () => {
        if (session.pendingPrompt?.id !== promptId) return;
        session.pendingPrompt = undefined;
        session.prompt = null;
        this.change(session, session.authUrl || session.deviceCode ? "waiting_external" : "pending");
        reject(new Error("Login prompt was completed by the provider callback"));
      };
      const detach = () => {
        if (detached) return;
        detached = true;
        prompt.signal?.removeEventListener("abort", onPromptAbort);
      };
      session.pendingPrompt = {
        id: promptId,
        type: prompt.type,
        resolve: (value) => {
          detach();
          resolve(value);
        },
        reject: (error) => {
          detach();
          reject(error);
        },
        detach
      };
      prompt.signal?.addEventListener("abort", onPromptAbort, { once: true });
      if (prompt.signal?.aborted) onPromptAbort();
    });
  }

  private stop(session: LoginSession, reason: "cancelled" | "expired"): void {
    session.cancelReason = reason;
    session.abortController.abort();
    const pending = session.pendingPrompt;
    if (pending) {
      pending.detach();
      session.pendingPrompt = undefined;
      session.prompt = null;
      pending.reject(new Error(reason === "expired" ? "Login expired" : "Login cancelled"));
    }
    this.change(session, reason);
  }

  private change(session: LoginSession, state: OAuthLoginState): void {
    session.state = state;
    session.revision += 1;
    session.updatedAt = this.now();
  }

  private scheduleExpiry(session: LoginSession): void {
    if (session.expiryTimer) clearTimeout(session.expiryTimer);
    const delay = Math.max(0, session.expiresAt - this.now());
    session.expiryTimer = setTimeout(() => {
      if (!isTerminal(session.state)) this.stop(session, "expired");
    }, delay);
    timerUnref(session.expiryTimer);
  }

  private scheduleRetention(session: LoginSession): void {
    if (session.expiryTimer) clearTimeout(session.expiryTimer);
    if (session.retentionTimer) return;
    session.retentionTimer = setTimeout(() => {
      this.sessions.delete(session.id);
    }, this.terminalRetentionMs);
    timerUnref(session.retentionTimer);
  }

  private requireSession(sessionId: string): LoginSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new OAuthLoginError("session_not_found", "Login session not found or expired.");
    return session;
  }

  private snapshot(session: LoginSession): OAuthLoginSnapshot {
    return {
      id: session.id,
      providerId: session.providerId,
      state: session.state,
      revision: session.revision,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      prompt: session.prompt
        ? {
            ...session.prompt,
            options: session.prompt.options?.map((option) => ({ ...option }))
          }
        : null,
      authUrl: session.authUrl ? { ...session.authUrl } : undefined,
      deviceCode: session.deviceCode ? { ...session.deviceCode } : undefined,
      messages: session.messages.map((message) => ({
        ...message,
        links: message.links?.map((link) => ({ ...link }))
      })),
      error: session.error
    };
  }
}

const oauthLoginManager = new OAuthLoginManager();

export function getOAuthLoginManager(): OAuthLoginManager {
  return oauthLoginManager;
}

export function listOAuthProviderIds(): string[] {
  return oauthLoginManager.listOAuthProviderIds();
}

export async function resolveProviderApiKey(
  provider: string,
  fallback?: () => string | undefined
): Promise<string | undefined> {
  const fallbackKey = fallback?.()?.trim();
  const resolved = await getPiModels().getAuth(provider, {
    apiKey: fallbackKey || undefined
  });
  return (resolved?.auth.apiKey ?? fallbackKey) || undefined;
}

export async function removeStoredAuth(provider: string): Promise<boolean> {
  return oauthLoginManager.logout(provider);
}

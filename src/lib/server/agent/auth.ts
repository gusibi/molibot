import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import {
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  type OAuthCredentials,
  type OAuthProviderId
} from "@mariozechner/pi-ai/oauth";
import { config } from "../app/env.js";

export interface ApiKeyCredential {
  type: "api_key";
  key: string;
}

export type OAuthCredential = { type: "oauth" } & OAuthCredentials;
export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthData = Record<string, AuthCredential>;

interface LoginStartOptions {
  onAuth?: (info: { url: string; instructions?: string }) => void;
  onPrompt?: (message: string) => void;
  onProgress?: (message: string) => void;
}

interface PendingLogin {
  providerId: OAuthProviderId;
  startedAt: number;
  authUrl?: string;
  instructions?: string;
  promptMessage?: string;
  bufferedCode?: string;
  resolveCode?: (value: string) => void;
  rejectCode?: (error: Error) => void;
  completion: Promise<void>;
}

function ensureParentDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function normalizeAuthInfo(args: unknown[]): { url: string; instructions?: string } {
  const first = args[0];
  if (first && typeof first === "object") {
    const row = first as { url?: unknown; instructions?: unknown };
    return {
      url: String(row.url ?? "").trim(),
      instructions: String(row.instructions ?? "").trim() || undefined
    };
  }

  return {
    url: String(first ?? "").trim(),
    instructions: String(args[1] ?? "").trim() || undefined
  };
}

function normalizePromptMessage(input: unknown): string {
  if (typeof input === "string") return input.trim() || "Paste the authorization code or redirect URL.";
  if (input && typeof input === "object") {
    const row = input as { message?: unknown; label?: unknown };
    const message = String(row.message ?? row.label ?? "").trim();
    if (message) return message;
  }
  return "Paste the authorization code or redirect URL.";
}

export function resolveAuthFilePath(): string {
  const explicit = String(process.env.PI_AI_AUTH_FILE ?? "").trim();
  return explicit || join(config.dataDir, "auth.json");
}

export function loadAuthData(authFilePath: string = resolveAuthFilePath()): AuthData {
  if (!existsSync(authFilePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(authFilePath, "utf8"));
    return raw && typeof raw === "object" ? (raw as AuthData) : {};
  } catch {
    return {};
  }
}

export function saveAuthData(data: AuthData, authFilePath: string = resolveAuthFilePath()): void {
  ensureParentDir(authFilePath);
  writeFileSync(authFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    chmodSync(authFilePath, 0o600);
  } catch {
    // ignore chmod failures on unsupported filesystems
  }
}

export function listOAuthProviderIds(): string[] {
  return getOAuthProviders()
    .map((provider) => String((provider as { id?: unknown }).id ?? "").trim())
    .filter(Boolean)
    .sort();
}

export function hasConfiguredAuth(provider: string, fallback?: () => string | undefined): boolean {
  const auth = loadAuthData();
  const stored = auth[provider];
  if (stored?.type === "api_key" && stored.key.trim()) return true;
  if (stored?.type === "oauth") return true;
  if (getEnvApiKey(provider)) return true;
  return Boolean(fallback?.()?.trim());
}

export async function resolveProviderApiKey(
  provider: string,
  fallback?: () => string | undefined
): Promise<string | undefined> {
  const auth = loadAuthData();
  const stored = auth[provider];

  if (stored?.type === "api_key") {
    const key = stored.key.trim();
    if (key) return key;
  }

  if (stored?.type === "oauth") {
    const oauthProvider = getOAuthProvider(provider as OAuthProviderId);
    if (oauthProvider) {
      const oauthCreds: Record<string, OAuthCredentials> = {};
      for (const [providerId, credential] of Object.entries(auth)) {
        if (credential?.type === "oauth") {
          oauthCreds[providerId] = credential;
        }
      }

      const result = await getOAuthApiKey(provider as OAuthProviderId, oauthCreds);
      if (result) {
        auth[provider] = { type: "oauth", ...result.newCredentials };
        saveAuthData(auth);
        return result.apiKey;
      }
    }
  }

  const envKey = getEnvApiKey(provider);
  if (envKey) return envKey;

  const fallbackKey = fallback?.()?.trim();
  return fallbackKey || undefined;
}

export function removeStoredAuth(provider: string): boolean {
  const auth = loadAuthData();
  if (!(provider in auth)) return false;
  delete auth[provider];
  saveAuthData(auth);
  return true;
}

const pendingLogins = new Map<string, PendingLogin>();

export function getPendingLogin(scopeKey: string): PendingLogin | undefined {
  return pendingLogins.get(scopeKey);
}

export async function startOAuthLogin(
  scopeKey: string,
  providerId: string,
  options?: LoginStartOptions
): Promise<PendingLogin> {
  const normalized = providerId.trim() as OAuthProviderId;
  const provider = getOAuthProvider(normalized);
  if (!provider) {
    throw new Error(
      `Unsupported login provider '${providerId}'. Available: ${listOAuthProviderIds().join(", ")}`
    );
  }

  const existing = pendingLogins.get(scopeKey);
  if (existing) {
    if (existing.providerId !== normalized) {
      throw new Error(
        `Login already pending for '${existing.providerId}'. Finish it first, then start '${normalized}'.`
      );
    }
    return existing;
  }

  const pending: PendingLogin = {
    providerId: normalized,
    startedAt: Date.now(),
    completion: Promise.resolve()
  };
  let readyResolve: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  pending.completion = (async () => {
    try {
      const credentials = await provider.login({
        onAuth: (...args: unknown[]) => {
          const info = normalizeAuthInfo(args);
          pending.authUrl = info.url;
          pending.instructions = info.instructions;
          options?.onAuth?.(info);
          readyResolve?.();
        },
        onPrompt: async (prompt: unknown) => {
          pending.promptMessage = normalizePromptMessage(prompt);
          options?.onPrompt?.(pending.promptMessage);
          readyResolve?.();
          if (pending.bufferedCode) {
            const buffered = pending.bufferedCode;
            pending.bufferedCode = undefined;
            return buffered;
          }
          return await new Promise<string>((resolve, reject) => {
            pending.resolveCode = resolve;
            pending.rejectCode = reject;
          });
        },
        onProgress: (message: unknown) => {
          const text = String(message ?? "").trim();
          if (text) options?.onProgress?.(text);
        }
      } as never);

      const auth = loadAuthData();
      auth[normalized] = { type: "oauth", ...credentials };
      saveAuthData(auth);
    } finally {
      pendingLogins.delete(scopeKey);
    }
  })();

  pendingLogins.set(scopeKey, pending);
  await Promise.race([
    ready,
    pending.completion.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 250))
  ]);
  return pending;
}

export async function submitOAuthLoginCode(
  scopeKey: string,
  providerId: string,
  codeOrUrl: string
): Promise<void> {
  const pending = pendingLogins.get(scopeKey);
  if (!pending || pending.providerId !== providerId.trim()) {
    throw new Error(`No pending login for '${providerId}'. Start with /login ${providerId} first.`);
  }

  const value = codeOrUrl.trim();
  if (!value) {
    throw new Error("Missing authorization code or redirect URL.");
  }

  if (pending.resolveCode) {
    const resolve = pending.resolveCode;
    pending.resolveCode = undefined;
    pending.rejectCode = undefined;
    resolve(value);
  } else {
    pending.bufferedCode = value;
  }

  await pending.completion;
}

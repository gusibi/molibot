import type {
  ApiKeyCredential,
  AuthEvent,
  AuthPrompt,
  OAuthCredential
} from "@earendil-works/pi-ai";
import { getPiModels } from "$lib/server/providers/piRuntime.js";
import { FileCredentialStore, type CredentialData } from "$lib/server/agent/identity/credentialStore.js";
import { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";

export { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";

export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthData = CredentialData;

interface LoginStartOptions {
  onAuth?: (info: { url: string; instructions?: string }) => void;
  onPrompt?: (message: string) => void;
  onProgress?: (message: string) => void;
}

interface PendingLogin {
  providerId: string;
  startedAt: number;
  authUrl?: string;
  instructions?: string;
  promptMessage?: string;
  bufferedCode?: string;
  resolveCode?: (value: string) => void;
  rejectCode?: (error: Error) => void;
  completion: Promise<void>;
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

export function listOAuthProviderIds(): string[] {
  return getPiModels().getProviders()
    .filter((provider) => Boolean(provider.auth.oauth))
    .map((provider) => provider.id)
    .sort();
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
  const store = new FileCredentialStore(resolveAuthFilePath());
  if (!await store.read(provider)) return false;
  await store.delete(provider);
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
  const normalized = providerId.trim();
  const provider = getPiModels().getProvider(normalized);
  if (!provider?.auth.oauth) {
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
      await getPiModels().login(normalized, "oauth", {
        notify: (event: AuthEvent) => {
          if (event.type === "auth_url") {
            pending.authUrl = event.url;
            pending.instructions = event.instructions;
            options?.onAuth?.({ url: event.url, instructions: event.instructions });
            readyResolve?.();
          } else if (event.type === "device_code") {
            pending.authUrl = event.verificationUri;
            pending.instructions = `Enter code: ${event.userCode}`;
            options?.onAuth?.({ url: event.verificationUri, instructions: pending.instructions });
            readyResolve?.();
          } else if (event.type === "progress" || event.type === "info") {
            const text = event.message.trim();
            if (text) options?.onProgress?.(text);
          }
        },
        prompt: async (prompt: AuthPrompt) => {
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
        }
      });
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

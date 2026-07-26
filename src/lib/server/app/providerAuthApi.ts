import { OAuthLoginError, safeErrorMessage } from "$lib/server/agent/identity/auth.js";
import type { RuntimeSettings } from "$lib/server/settings/schema";

/**
 * Provider ids whose saved settings carry a non-empty API key.
 *
 * These are passed to model calls as pi's `overrides.apiKey`, which pi resolves
 * *before* the credential store, so such a key silently wins over an OAuth
 * credential for the same provider. Only the id is returned — the key itself
 * must never cross into a response body.
 */
export function savedApiKeyOverrideIds(settings: RuntimeSettings): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const provider of settings.customProviders ?? []) {
    const id = String(provider?.id ?? "").trim();
    if (id && String(provider?.apiKey ?? "").trim()) ids.add(id);
  }
  return ids;
}

export interface ProviderAuthErrorPayload {
  ok: false;
  error: string;
  code?: string;
}

export function providerAuthError(error: unknown): {
  status: number;
  payload: ProviderAuthErrorPayload;
} {
  if (error instanceof OAuthLoginError) {
    const status = error.code === "session_not_found"
      ? 404
      : error.code === "provider_busy" || error.code === "session_finished" || error.code === "stale_prompt"
        ? 409
        : 400;
    return {
      status,
      payload: { ok: false, error: error.message, code: error.code }
    };
  }
  return {
    status: 500,
    payload: {
      ok: false,
      error: safeErrorMessage(error)
    }
  };
}

/**
 * The model a connectivity probe should default to for a provider.
 *
 * The catalog's first entry is a poor default: for Kimi Coding that is `k3`,
 * which a lower-tier subscription cannot call, so the probe would report a
 * working credential as broken. The model the user actually configured is the
 * one worth testing.
 */
export function defaultProbeModel(settings: RuntimeSettings, providerId: string): string | undefined {
  const provider = (settings.customProviders ?? []).find((row) => row?.id === providerId);
  if (!provider) return undefined;
  const preferred = String(provider.defaultModel ?? "").trim();
  if (preferred) return preferred;
  return (provider.models ?? [])
    .filter((model) => model?.enabled !== false)
    .map((model) => String(model?.id ?? "").trim())
    .find(Boolean);
}

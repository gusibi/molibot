import type {
  DesktopProviderAuthItem,
  DesktopProviderAuthSession,
  DesktopProviderAuthVerifyResponse
} from "@molibot/desktop-contract";
import {
  answerDesktopProviderAuth,
  cancelDesktopProviderAuth,
  loadDesktopProviderAuth,
  loadDesktopProviderAuthSession,
  logoutDesktopProviderAuth,
  startDesktopProviderAuth,
  verifyDesktopProviderAuth
} from "../api";
import { session, setError } from "./session.svelte";

const TERMINAL_STATES = new Set(["done", "failed", "cancelled", "expired"]);

export const providerAuthStore = $state({
  endpoint: "",
  /**
   * Endpoint the last overview request was issued for, success or failure.
   *
   * `loadProviderAuth` is called from a `$effect`, which tracks every store
   * field the call reads — so recording progress only on success made a failing
   * request re-enter the effect the moment `loading` fell back to false, hot
   * retrying once per round trip with no backoff. This marker bounds it to one
   * attempt per endpoint; `resetProviderAuthRequest` re-arms it when the service
   * goes away, so a restart still refetches.
   */
  requestedEndpoint: "",
  providers: [] as DesktopProviderAuthItem[],
  loading: false,
  actionProviderId: "",
  active: null as DesktopProviderAuthSession | null,
  answer: "",
  error: "",
  pollGeneration: 0,
  verifying: "",
  /** Last connectivity probe, keyed by provider id. */
  verified: {} as Record<string, DesktopProviderAuthVerifyResponse["result"]>
});

export function providerAuthFor(providerId: string): DesktopProviderAuthItem | undefined {
  return providerAuthStore.providers.find((provider) => provider.id === providerId);
}

export function providerAuthIsTerminal(state: DesktopProviderAuthSession["state"]): boolean {
  return TERMINAL_STATES.has(state);
}

/** Allow the next automatic overview fetch, e.g. after the service restarts. */
export function resetProviderAuthRequest(): void {
  providerAuthStore.requestedEndpoint = "";
}

export async function loadProviderAuth(force = false): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || providerAuthStore.loading) return;
  if (!force && providerAuthStore.requestedEndpoint === endpoint) return;
  providerAuthStore.requestedEndpoint = endpoint;
  providerAuthStore.loading = true;
  try {
    providerAuthStore.providers = await loadDesktopProviderAuth(endpoint);
    providerAuthStore.endpoint = endpoint;
  } catch (cause) {
    setError(cause);
  } finally {
    providerAuthStore.loading = false;
  }
}

export async function beginProviderAuth(providerId: string): Promise<void> {
  if (!session.endpoint || providerAuthStore.actionProviderId) return;
  const generation = ++providerAuthStore.pollGeneration;
  providerAuthStore.actionProviderId = providerId;
  providerAuthStore.error = "";
  providerAuthStore.answer = "";
  try {
    providerAuthStore.active = await startDesktopProviderAuth(session.endpoint, providerId);
    void pollProviderAuth(providerAuthStore.active.id, generation);
  } catch (cause) {
    providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providerAuthStore.actionProviderId = "";
  }
}

async function pollProviderAuth(sessionId: string, generation: number): Promise<void> {
  while (generation === providerAuthStore.pollGeneration && providerAuthStore.active?.id === sessionId) {
    if (providerAuthIsTerminal(providerAuthStore.active.state)) {
      await loadProviderAuth(true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (generation !== providerAuthStore.pollGeneration || providerAuthStore.active?.id !== sessionId || !session.endpoint) return;
    try {
      providerAuthStore.active = await loadDesktopProviderAuthSession(session.endpoint, sessionId);
    } catch (cause) {
      if (generation !== providerAuthStore.pollGeneration) return;
      providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
      return;
    }
  }
}

export async function submitProviderAuthAnswer(value = providerAuthStore.answer): Promise<void> {
  const active = providerAuthStore.active;
  const prompt = active?.prompt;
  if (!session.endpoint || !active || !prompt || providerAuthStore.actionProviderId) return;
  providerAuthStore.actionProviderId = active.providerId;
  providerAuthStore.error = "";
  try {
    providerAuthStore.active = await answerDesktopProviderAuth(session.endpoint, active.id, {
      promptId: prompt.id,
      value
    });
    providerAuthStore.answer = "";
  } catch (cause) {
    providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providerAuthStore.actionProviderId = "";
  }
}

export async function closeProviderAuth(): Promise<void> {
  const active = providerAuthStore.active;
  ++providerAuthStore.pollGeneration;
  providerAuthStore.active = null;
  providerAuthStore.answer = "";
  providerAuthStore.error = "";
  if (!session.endpoint || !active || providerAuthIsTerminal(active.state)) return;
  try {
    await cancelDesktopProviderAuth(session.endpoint, active.id);
  } catch {
    // Session expiry/service interruption already leaves no actionable dialog state.
  }
}

export async function logoutProviderAuth(providerId: string): Promise<void> {
  if (!session.endpoint || providerAuthStore.actionProviderId) return;
  providerAuthStore.actionProviderId = providerId;
  providerAuthStore.error = "";
  try {
    await logoutDesktopProviderAuth(session.endpoint, providerId);
    await loadProviderAuth(true);
  } catch (cause) {
    providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providerAuthStore.actionProviderId = "";
  }
}

/**
 * Send one real request through the stored credential.
 *
 * "Signed in" only means a credential is on disk; this is what turns it into
 * "actually reaches the model". The probe result is kept per provider so
 * switching rows does not show a stale verdict.
 */
export async function verifyProviderAuth(providerId: string, model?: string): Promise<void> {
  if (!session.endpoint || providerAuthStore.verifying) return;
  providerAuthStore.verifying = providerId;
  providerAuthStore.error = "";
  try {
    const result = await verifyDesktopProviderAuth(session.endpoint, providerId, model);
    providerAuthStore.verified = { ...providerAuthStore.verified, [providerId]: result };
  } catch (cause) {
    providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providerAuthStore.verifying = "";
  }
}

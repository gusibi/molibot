// Shared, cross-section runtime state for the settings window.
//
// The desktop settings UI is composed of many per-domain sections that each
// live in their own component + store module. This module holds the handful of
// values every section needs — the service endpoint, readiness, the active
// locale + translation table, and the shared error banner text — so sections
// don't have to prop-drill them.
//
// `App.svelte` (the shell) owns the source of truth for status/locale and
// mirrors the derived values into `session` on change; the runes-mode section
// components read from `session` directly.
import { initialLocale, normalizeLocale, translator, type Locale, type Translation } from "../i18n";

const LOCALE_STORAGE_KEY = "molibot-desktop-locale";
const storedLocale = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
const startLocale: Locale = storedLocale ? normalizeLocale(storedLocale) : initialLocale();

export const session = $state({
  /** Service endpoint URL once the managed/external service is reachable. */
  endpoint: null as string | null,
  /** True when the service is in the `ready` state with a usable endpoint. */
  serviceReady: false,
  locale: startLocale as Locale,
  text: translator(startLocale) as Translation,
  /** Shared error-banner text; empty string hides the banner. */
  error: ""
});

/** Normalises any thrown value into the shared error-banner message. */
export function setError(cause: unknown): void {
  session.error = cause instanceof Error ? cause.message : String(cause);
}

export function clearError(): void {
  session.error = "";
}

export function notifySettingsChanged(): void {
  try {
    const channel = new BroadcastChannel("molibot-settings-channel");
    channel.postMessage({ type: "refresh-models" });
    channel.close();
  } catch (e) {
    console.error("Failed to notify settings changed:", e);
  }
}

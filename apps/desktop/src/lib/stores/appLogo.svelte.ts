import { invoke } from "@tauri-apps/api/core";
import type { Locale } from "../i18n";
import logos from "./appLogos.json";

const STORAGE_KEY = "molibot-desktop-app-logo";
export const APP_LOGOS = logos;
export type AppLogoOption = (typeof APP_LOGOS)[number];

export function normalizeAppLogoId(value: string | null | undefined): string {
  return APP_LOGOS.find((logo) => logo.id === value)?.id ?? "molibot";
}

export function appLogoLabel(logo: AppLogoOption, locale: Locale): string {
  return locale === "zh-CN" ? logo.labelZh : logo.labelEn;
}

type LogoHost = { read(): Promise<string>; write(id: string): Promise<string> };
type LogoStorage = Pick<Storage, "getItem" | "setItem">;

/** Native persistence owns desktop identity; localStorage is only for browser previews. */
export function createAppLogoStore(host: LogoHost | null, storage: LogoStorage | null) {
  const initial = normalizeAppLogoId(host ? null : storage?.getItem(STORAGE_KEY));
  const state = $state({ id: initial, src: APP_LOGOS.find((logo) => logo.id === initial)!.src, busy: false, ready: !host, error: "" });

  function confirm(id: string) {
    state.id = normalizeAppLogoId(id);
    state.src = APP_LOGOS.find((logo) => logo.id === state.id)!.src;
  }

  async function initialize() {
    if (!host || state.busy) return;
    state.busy = true;
    try {
      confirm(await host.read());
      state.error = "";
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      state.ready = true;
      state.busy = false;
    }
  }

  async function select(id: string) {
    if (state.busy || !state.ready) return;
    state.busy = true;
    state.error = "";
    const normalized = normalizeAppLogoId(id);
    try {
      if (host) confirm(await host.write(normalized));
      else {
        storage?.setItem(STORAGE_KEY, normalized);
        confirm(normalized);
      }
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      state.busy = false;
    }
  }

  return { state, initialize, select };
}

const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const store = createAppLogoStore(native ? {
  read: () => invoke<string>("get_app_logo"),
  write: (id) => invoke<string>("set_app_logo", { id })
} : null, typeof window !== "undefined" ? window.localStorage : null);

export const appLogo = store.state;
export const initializeAppLogo = store.initialize;
export const setAppLogo = store.select;

if (!native && typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) void store.select(normalizeAppLogoId(event.newValue));
  });
}

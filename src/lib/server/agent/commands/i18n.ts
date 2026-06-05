import type { RuntimeLocale } from "$lib/server/settings/index.js";

export function normalizeRuntimeLocale(value: unknown): RuntimeLocale {
  return value === "zh-CN" ? "zh-CN" : "en-US";
}

export function isChineseLocale(value: unknown): boolean {
  return normalizeRuntimeLocale(value) === "zh-CN";
}

export function commandText(locale: unknown, english: string, chinese: string): string {
  return isChineseLocale(locale) ? chinese : english;
}

export function commandLocaleFromSettings(settings: { locale?: unknown }): RuntimeLocale {
  return normalizeRuntimeLocale(settings.locale);
}

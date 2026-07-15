import type { RuntimeSettings } from "../schema.js";

export type SupportedLocale = "zh-CN" | "en-US";

export function sanitizeLocale(value: unknown): SupportedLocale {
  return value === "zh-CN" ? "zh-CN" : "en-US";
}

export interface SettingsAccessor {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

export function updateLocale(runtime: SettingsAccessor, locale: unknown): RuntimeSettings {
  return runtime.updateSettings({ locale: sanitizeLocale(locale) });
}

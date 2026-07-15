import { sanitizeSettings } from "../sanitize.js";
import type { CustomProviderConfig, RuntimeSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export interface CustomProvidersConfig {
  providerMode: RuntimeSettings["providerMode"];
  piModelProvider: RuntimeSettings["piModelProvider"];
  piModelName: RuntimeSettings["piModelName"];
  defaultCustomProviderId: RuntimeSettings["defaultCustomProviderId"];
  customProviders: CustomProviderConfig[];
}

export function readCustomProvidersConfig(runtime: SettingsAccessor): CustomProvidersConfig {
  const s = runtime.getSettings();
  return {
    providerMode: s.providerMode,
    piModelProvider: s.piModelProvider,
    piModelName: s.piModelName,
    defaultCustomProviderId: s.defaultCustomProviderId,
    customProviders: s.customProviders ?? []
  };
}

export function updateGlobalProviderSettings(
  runtime: SettingsAccessor,
  patch: {
    providerMode?: unknown;
    piModelProvider?: unknown;
    piModelName?: unknown;
    defaultCustomProviderId?: unknown;
  }
): CustomProvidersConfig {
  const current = runtime.getSettings();
  const sanitized = sanitizeSettings({
    providerMode: patch.providerMode,
    piModelProvider: patch.piModelProvider,
    piModelName: patch.piModelName,
    defaultCustomProviderId: patch.defaultCustomProviderId
  }, current);
  const updated = runtime.updateSettings({
    providerMode: sanitized.providerMode,
    piModelProvider: sanitized.piModelProvider,
    piModelName: sanitized.piModelName,
    defaultCustomProviderId: sanitized.defaultCustomProviderId
  });
  return readCustomProvidersConfig({ getSettings: () => updated, updateSettings: runtime.updateSettings });
}

export function replaceCustomProviders(
  runtime: SettingsAccessor,
  customProviders: unknown
): CustomProvidersConfig {
  const current = runtime.getSettings();
  const sanitized = sanitizeSettings({ customProviders }, current);
  const updated = runtime.updateSettings({
    customProviders: sanitized.customProviders,
    defaultCustomProviderId: sanitized.defaultCustomProviderId
  });
  return readCustomProvidersConfig({ getSettings: () => updated, updateSettings: runtime.updateSettings });
}

export function upsertCustomProvider(
  runtime: SettingsAccessor,
  provider: unknown,
  options?: { activateAsDefault?: boolean; switchToCustomMode?: boolean }
): { config: CustomProvidersConfig; saved: CustomProviderConfig } {
  if (!provider || typeof provider !== "object") throw new Error("provider is required");
  const current = runtime.getSettings();
  const id = String((provider as Record<string, unknown>).id ?? "").trim();
  const existing = (current.customProviders ?? []).filter((p) => p.id !== id);
  const merged = [...existing, provider as CustomProviderConfig];
  const activateAsDefault = options?.activateAsDefault === true;
  const requestedDefault = activateAsDefault ? id : current.defaultCustomProviderId;
  const sanitized = sanitizeSettings(
    { customProviders: merged, defaultCustomProviderId: requestedDefault },
    current
  );
  const patch: Partial<RuntimeSettings> = {
    customProviders: sanitized.customProviders,
    defaultCustomProviderId: sanitized.defaultCustomProviderId
  };
  if (options?.switchToCustomMode === true) {
    patch.providerMode = "custom";
  }
  const updated = runtime.updateSettings(patch);
  const saved = (updated.customProviders ?? []).find((p) => p.id === id);
  if (!saved) throw new Error("Provider was not persisted");
  return { config: readCustomProvidersConfig({ getSettings: () => updated, updateSettings: runtime.updateSettings }), saved };
}

export function deleteCustomProvider(
  runtime: SettingsAccessor,
  providerId: string
): CustomProvidersConfig {
  const id = String(providerId ?? "").trim();
  if (!id) throw new Error("id is required");
  const current = runtime.getSettings();
  const remaining = (current.customProviders ?? []).filter((p) => p.id !== id);
  const sanitized = sanitizeSettings({ customProviders: remaining }, current);
  const updated = runtime.updateSettings({
    customProviders: sanitized.customProviders,
    defaultCustomProviderId: sanitized.defaultCustomProviderId
  });
  return readCustomProvidersConfig({ getSettings: () => updated, updateSettings: runtime.updateSettings });
}

import type {
  TtsGenerateMacosProviderSettings,
  TtsGenerateSettings,
  TtsGenerateXiaomiProviderSettings
} from "$lib/server/settings/schema";
import type { DesktopTtsProvider, DesktopTtsSummary } from "$lib/shared/desktop";
import type { DesktopTtsUpdateRequest } from "$lib/shared/desktop";
import { sanitizeTtsGenerateSettings } from "$lib/server/settings/sanitize";

/**
 * Maps the macOS system-voice provider into a Desktop view. It uses built-in
 * system voices and has no API key, so `hasApiKey` is always false and
 * `model`/`baseUrl` stay empty.
 */
export function buildDesktopTtsMacosProvider(
  settings: TtsGenerateMacosProviderSettings
): DesktopTtsProvider {
  return {
    id: "macos",
    enabled: settings.enabled === true,
    voice: settings.voice ?? "",
    format: settings.format ?? "",
    hasApiKey: false,
    model: "",
    baseUrl: ""
  };
}

/**
 * Maps the Xiaomi MiMo TTS provider into a credential-safe Desktop view. The
 * `apiKey` is reduced to a `hasApiKey` boolean — the raw key never reaches the
 * WebView; `baseUrl`/`model`/`voice`/`format` are not secrets and stay.
 */
export function buildDesktopTtsXiaomiProvider(
  settings: TtsGenerateXiaomiProviderSettings
): DesktopTtsProvider {
  return {
    id: "xiaomi",
    enabled: settings.enabled === true,
    voice: settings.voice ?? "",
    format: settings.format ?? "",
    hasApiKey: typeof settings.apiKey === "string" && settings.apiKey.trim().length > 0,
    model: settings.model ?? "",
    baseUrl: settings.baseUrl ?? ""
  };
}

/**
 * Maps the TTS settings into a credential-safe Desktop summary. Each provider is
 * projected field-by-field (per the §11 invariant); the Xiaomi API key is
 * dropped to a `hasApiKey` flag and no raw key reaches the WebView.
 */
export function buildDesktopTtsSummary(settings: TtsGenerateSettings): DesktopTtsSummary {
  return {
    enabled: settings.enabled === true,
    defaultProvider: settings.defaultProvider,
    providers: [
      buildDesktopTtsMacosProvider(settings.providers.macos),
      buildDesktopTtsXiaomiProvider(settings.providers.xiaomi)
    ]
  };
}

export function updateDesktopTtsSettings(current: TtsGenerateSettings, request: DesktopTtsUpdateRequest): TtsGenerateSettings {
  const updates = new Map((request.providers ?? []).map((provider) => [provider.id, provider]));
  const macos = updates.get("macos");
  const xiaomi = updates.get("xiaomi");
  const replacement = String(xiaomi?.apiKey ?? "").trim();
  return sanitizeTtsGenerateSettings({
    enabled: request.enabled,
    defaultProvider: request.defaultProvider,
    providers: {
      macos: {
        enabled: macos?.enabled ?? current.providers.macos.enabled,
        voice: macos?.voice ?? current.providers.macos.voice,
        format: macos?.format ?? current.providers.macos.format
      },
      xiaomi: {
        enabled: xiaomi?.enabled ?? current.providers.xiaomi.enabled,
        voice: xiaomi?.voice ?? current.providers.xiaomi.voice,
        format: xiaomi?.format ?? current.providers.xiaomi.format,
        baseUrl: xiaomi?.baseUrl ?? current.providers.xiaomi.baseUrl,
        model: xiaomi?.model ?? current.providers.xiaomi.model,
        apiKey: xiaomi?.clearApiKey ? "" : replacement || current.providers.xiaomi.apiKey
      }
    }
  }, current);
}

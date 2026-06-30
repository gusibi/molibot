import type { DesktopMediaEngine, DesktopMediaGenerateSummary } from "$lib/shared/desktop";
import type { DesktopMediaGenerateUpdateRequest } from "$lib/shared/desktop";

/**
 * The slice of an image/video-generate engine the Desktop mapper reads. Both
 * `ImageGenerateEngineSettings` and `VideoGenerateEngineSettings` share this
 * shape, so a single credential-safe mapper serves both sections.
 */
export interface MediaEngineSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface MediaGenerateSettings {
  enabled: boolean;
  defaultEngine: string;
  engines?: Record<string, MediaEngineSettings>;
}

/**
 * Maps one image/video engine into a credential-safe Desktop view. The engine
 * `apiKey` becomes a `hasApiKey` boolean — the raw key never reaches the WebView.
 * `baseUrl` (an endpoint) and `model` (a model id) are not secrets, so they stay.
 */
export function buildDesktopMediaEngine(id: string, engine: MediaEngineSettings): DesktopMediaEngine {
  return {
    id,
    enabled: engine.enabled === true,
    hasApiKey: typeof engine.apiKey === "string" && engine.apiKey.trim().length > 0,
    baseUrl: engine.baseUrl ?? "",
    model: engine.model ?? ""
  };
}

/**
 * Maps image/video-generate settings into a credential-safe Desktop summary.
 * Per-engine API keys drop to `hasApiKey`; the summary keeps the enabled flag,
 * default engine, an ordered engine list, and aggregate counts.
 */
export function buildDesktopMediaGenerateSummary(
  settings: MediaGenerateSettings
): DesktopMediaGenerateSummary {
  const engineEntries = settings.engines ? Object.entries(settings.engines) : [];
  const engines = engineEntries.map(([id, engine]) => buildDesktopMediaEngine(id, engine));

  return {
    enabled: settings.enabled === true,
    defaultEngine: settings.defaultEngine,
    engines,
    counts: {
      totalEngines: engines.length,
      enabledEngines: engines.filter((engine) => engine.enabled).length,
      configuredEngines: engines.filter((engine) => engine.hasApiKey).length
    }
  };
}

export function buildDesktopMediaGenerateInput(
  current: MediaGenerateSettings,
  request: DesktopMediaGenerateUpdateRequest
): MediaGenerateSettings {
  const updates = new Map((request.engines ?? []).map((engine) => [engine.id, engine]));
  const engines = Object.fromEntries(Object.entries(current.engines ?? {}).map(([id, engine]) => {
    const update = updates.get(id);
    const replacement = String(update?.apiKey ?? "").trim();
    return [id, {
      enabled: update?.enabled ?? engine.enabled,
      baseUrl: update?.baseUrl ?? engine.baseUrl,
      model: update?.model ?? engine.model,
      apiKey: update?.clearApiKey ? "" : replacement || engine.apiKey
    }];
  }));
  return { enabled: request.enabled, defaultEngine: request.defaultEngine, engines };
}

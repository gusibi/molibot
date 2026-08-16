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
  name?: string;
  protocol?: "images-generations" | "chat-completions";
}

export interface MediaGenerateSettings {
  enabled: boolean;
  defaultEngine: string;
  engines?: Record<string, MediaEngineSettings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDesktopMediaGenerateUpdateRequest(value: unknown): value is DesktopMediaGenerateUpdateRequest {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.defaultEngine !== "string" || !Array.isArray(value.engines)) {
    return false;
  }
  return value.engines.every((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.enabled !== "boolean") return false;
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(raw.id) || raw.id === "auto") return false;
    if (typeof raw.baseUrl !== "string" || typeof raw.model !== "string") return false;
    if (raw.apiKey !== undefined && typeof raw.apiKey !== "string") return false;
    if (raw.clearApiKey !== undefined && typeof raw.clearApiKey !== "boolean") return false;
    if (raw.name !== undefined && typeof raw.name !== "string") return false;
    return raw.protocol === undefined
      || raw.protocol === "images-generations"
      || raw.protocol === "chat-completions";
  });
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
    model: engine.model ?? "",
    ...(engine.name ? { name: engine.name } : {}),
    ...(engine.protocol ? { protocol: engine.protocol } : {})
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
  request: DesktopMediaGenerateUpdateRequest,
  builtinEngineIds?: Set<string>
): MediaGenerateSettings {
  const updates = new Map((Array.isArray(request?.engines) ? request.engines : []).map((engine) => [engine.id, engine]));
  const engineIds = new Set<string>([
    ...Object.keys(current.engines ?? {}),
    ...updates.keys()
  ]);

  const engines: Record<string, MediaEngineSettings> = {};
  for (const id of engineIds) {
    // Allow callers to drop custom engines that are no longer in the request.
    if (builtinEngineIds && !builtinEngineIds.has(id) && !updates.has(id)) continue;

    const engine = current.engines?.[id] ?? { enabled: false, apiKey: "" };
    const update = updates.get(id);
    const replacement = String(update?.apiKey ?? "").trim();
    const protocol = engine.protocol ?? update?.protocol;
    engines[id] = {
      enabled: update?.enabled ?? engine.enabled,
      baseUrl: update?.baseUrl ?? engine.baseUrl,
      model: update?.model ?? engine.model,
      apiKey: update?.clearApiKey ? "" : replacement || engine.apiKey,
      ...(engine.name ? { name: engine.name } : {}),
      ...(update?.name ? { name: update.name } : {}),
      ...(protocol ? { protocol } : {})
    };
  }
  return { enabled: request.enabled, defaultEngine: request.defaultEngine, engines };
}

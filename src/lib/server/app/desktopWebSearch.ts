import type { WebSearchEngineSettings, WebSearchSettings } from "$lib/server/settings/schema";
import type { DesktopWebSearchEngine, DesktopWebSearchSummary } from "$lib/shared/desktop";
import type { DesktopWebSearchUpdateRequest } from "$lib/shared/desktop";
import { sanitizeWebSearchSettings } from "$lib/server/settings/sanitize";

/**
 * Maps one web-search engine's settings into a credential-safe Desktop view.
 * The engine `apiKey` is replaced by a `hasApiKey` boolean — the raw key never
 * reaches the WebView. `baseUrl` is an endpoint, not a secret, so it is kept.
 */
export function buildDesktopWebSearchEngine(
  id: string,
  engine: WebSearchEngineSettings
): DesktopWebSearchEngine {
  return {
    id,
    enabled: engine.enabled === true,
    hasApiKey: typeof engine.apiKey === "string" && engine.apiKey.trim().length > 0,
    baseUrl: engine.baseUrl ?? ""
  };
}

/**
 * Maps the web-search settings into a credential-safe Desktop summary. Per-engine
 * API keys are dropped to `hasApiKey` flags; the summary keeps only the routing
 * config (enabled, default route/engine, selection strategy, limits) and an
 * ordered engine list with aggregate counts.
 */
export function buildDesktopWebSearchSummary(settings: WebSearchSettings): DesktopWebSearchSummary {
  const engineEntries = settings.engines ? Object.entries(settings.engines) : [];
  const engines = engineEntries.map(([id, engine]) => buildDesktopWebSearchEngine(id, engine));

  return {
    enabled: settings.enabled === true,
    defaultRoute: settings.defaultRoute,
    defaultEngine: settings.defaultEngine,
    engineSelectionStrategy: settings.engineSelectionStrategy,
    maxResults: settings.maxResults,
    timeoutMs: settings.timeoutMs,
    retryTimeoutMs: settings.retryTimeoutMs,
    engines,
    counts: {
      totalEngines: engines.length,
      enabledEngines: engines.filter((engine) => engine.enabled).length,
      configuredEngines: engines.filter((engine) => engine.hasApiKey).length
    }
  };
}

export function updateDesktopWebSearchSettings(
  current: WebSearchSettings,
  request: DesktopWebSearchUpdateRequest
): WebSearchSettings {
  const updates = new Map((request.engines ?? []).map((engine) => [engine.id, engine]));
  const engines = Object.fromEntries(Object.entries(current.engines).map(([id, engine]) => {
    const update = updates.get(id);
    const replacement = String(update?.apiKey ?? "").trim();
    return [id, {
      enabled: update?.enabled ?? engine.enabled,
      baseUrl: update?.baseUrl ?? engine.baseUrl,
      apiKey: update?.clearApiKey ? "" : replacement || engine.apiKey
    }];
  }));
  return sanitizeWebSearchSettings({ ...request, engines }, current);
}

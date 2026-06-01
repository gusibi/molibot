import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { WEB_SEARCH_PROVIDERS } from "$lib/server/agent/search/providers.js";
import { inferWebSearchRoute, resolveWebSearchEngines } from "$lib/server/agent/search/router.js";
import type { WebSearchAttempt, WebSearchEngine, WebSearchInput, WebSearchResponse } from "$lib/server/agent/search/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const webSearchSchema = Type.Object({
  query: Type.String({
    description: [
      "Search query. Keep it concise.",
      "For recent/current/latest information, include the current year or a concrete date when it improves freshness."
    ].join(" ")
  }),
  maxResults: Type.Optional(Type.Number({ description: "Maximum results to return. Defaults to the configured webSearch.maxResults." })),
  engine: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("duckduckgo"),
    Type.Literal("brave"),
    Type.Literal("tavily"),
    Type.Literal("exa"),
    Type.Literal("serper"),
    Type.Literal("baidu"),
    Type.Literal("bocha")
  ])),
  route: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("domestic_news"),
    Type.Literal("international_news"),
    Type.Literal("chinese_general"),
    Type.Literal("global_general")
  ])),
  includeDomains: Type.Optional(Type.Array(Type.String({ description: "Domains to prefer/include, e.g. example.com. Use only when the user asks for specific sources or authoritative sites." }))),
  excludeDomains: Type.Optional(Type.Array(Type.String({ description: "Domains to exclude, e.g. spam.example. Use sparingly." })))
});

function currentMonthYear(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: timezone
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric"
    }).format(new Date());
  }
}

function buildWebSearchDescription(settings: RuntimeSettings): string {
  const monthYear = currentMonthYear(settings.timezone);
  return [
    "- Search the web with Molibot's configured built-in search engines and use the results to inform the response.",
    "- Provides up-to-date information for current events, recent data, latest documentation, prices, schedules, external webpages, and facts beyond the model's knowledge cutoff.",
    "- Returns normalized search results with titles, URLs, snippets, route diagnostics, and the engine used. Searches are performed inside this single tool call; do not shell out to skill scripts for ordinary web search.",
    "",
    "CRITICAL REQUIREMENT:",
    "- When you use this tool to answer the user, include a \"Sources:\" section at the end of your final response.",
    "- List the relevant URLs from the search results as Markdown links using this format:",
    "  Sources:",
    "  - [Source Title](https://example.com/page)",
    "- Do not cite results you did not use. If the tool returns no usable sources, say that clearly instead of fabricating citations.",
    "",
    "Usage notes:",
    "- Use this tool when the user asks to search, look up, verify, or needs current/latest/recent information.",
    "- Domain filtering is supported with includeDomains and excludeDomains.",
    "- Prefer route=\"auto\" and engine=\"auto\" unless the user asks for a specific region/source or you have a clear reason to override routing.",
    "- Chinese/domestic queries can route to Chinese engines; global or international queries can route to global engines.",
    "",
    "IMPORTANT - Use the correct year in search queries:",
    `- The current month is ${monthYear}. Use this year for recent information, documentation, releases, prices, schedules, and current events.`,
    "- Example: If the user asks for latest framework docs, search for the framework documentation with the current year when needed, not an old year."
  ].join("\n");
}

function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeInput(input: any, settings: RuntimeSettings["webSearch"]): WebSearchInput {
  return {
    query: String(input?.query ?? "").trim(),
    maxResults: Math.max(1, Math.min(20, Number(input?.maxResults ?? settings.maxResults) || settings.maxResults)),
    engine: input?.engine,
    route: input?.route,
    includeDomains: normalizeStringArray(input?.includeDomains),
    excludeDomains: normalizeStringArray(input?.excludeDomains)
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort|timeout/i.test(error.message));
}

async function withTimeout<T>(timeoutMs: number, signal: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function summarize(results: WebSearchResponse["results"]): string {
  if (results.length === 0) return "No search results returned.";
  return results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join("\n\n");
}

export async function runWebSearch(
  rawInput: unknown,
  settings: RuntimeSettings["webSearch"],
  signal?: AbortSignal
): Promise<WebSearchResponse> {
  const input = normalizeInput(rawInput, settings);
  if (!settings.enabled) throw new Error("Built-in web search is disabled in settings.");
  if (!input.query) throw new Error("Search query is required.");

  const route = inferWebSearchRoute(input.query, input.route, settings);
  const engines = resolveWebSearchEngines(input, settings, route);
  const attempts: WebSearchAttempt[] = [];

  for (const engine of engines) {
    const provider = WEB_SEARCH_PROVIDERS[engine];
    const engineSettings = settings.engines[engine];
    if (!provider || !engineSettings?.enabled) {
      attempts.push({ engine, route, ok: false, skipped: true, error: "engine_disabled" });
      continue;
    }
    if (engine !== "duckduckgo" && !engineSettings.apiKey.trim()) {
      attempts.push({ engine, route, ok: false, skipped: true, error: "missing_api_key" });
      continue;
    }

    const runAttempt = async (timeoutMs: number) => {
      return withTimeout(timeoutMs, signal, (attemptSignal) =>
        provider.search({ ...input, query: input.query }, {
          settings,
          fetch: globalThis.fetch,
          signal: attemptSignal
        })
      );
    };

    try {
      const results = await runAttempt(settings.timeoutMs);
      attempts.push({ engine, route, ok: true, resultCount: results.length, timeoutMs: settings.timeoutMs });
      if (results.length > 0) {
        return {
          engine,
          route,
          query: input.query,
          results,
          summary: summarize(results),
          diagnostics: { attempts, fallbackOrder: engines }
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ engine, route, ok: false, error: message, timeoutMs: settings.timeoutMs });
      if (isAbortError(error) && settings.retryTimeoutMs > settings.timeoutMs) {
        try {
          const results = await runAttempt(settings.retryTimeoutMs);
          attempts.push({ engine, route, ok: true, resultCount: results.length, timeoutMs: settings.retryTimeoutMs });
          if (results.length > 0) {
            return {
              engine,
              route,
              query: input.query,
              results,
              summary: summarize(results),
              diagnostics: { attempts, fallbackOrder: engines }
            };
          }
        } catch (retryError) {
          attempts.push({
            engine,
            route,
            ok: false,
            error: retryError instanceof Error ? retryError.message : String(retryError),
            timeoutMs: settings.retryTimeoutMs
          });
        }
      }
    }
  }

  return {
    engine: null,
    route,
    query: input.query,
    results: [],
    summary: "No configured search engine returned results.",
    diagnostics: { attempts, fallbackOrder: engines }
  };
}

export function createWebSearchTool(options: {
  getSettings: () => RuntimeSettings;
}): AgentTool<typeof webSearchSchema> {
  const settings = options.getSettings();
  return {
    name: "webSearch",
    label: "webSearch",
    description: buildWebSearchDescription(settings),
    parameters: webSearchSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      try {
        const result = await runWebSearch(params, options.getSettings().webSearch, signal);
        return {
          content: [{ type: "text", text: result.summary }],
          details: result,
          metadata: {
            engine: result.engine,
            route: result.route,
            resultCount: result.results.length
          }
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { WEB_SEARCH_PROVIDERS } from "$lib/server/agent/search/providers.js";
import { inferWebSearchRoute, resolveWebSearchEngines } from "$lib/server/agent/search/router.js";
import type {
  WebSearchAttempt,
  WebSearchCitation,
  WebSearchEngine,
  WebSearchInput,
  WebSearchMetadata,
  WebSearchProviderResult,
  WebSearchRequestLog,
  WebSearchResponse,
  WebSearchResult
} from "$lib/server/agent/search/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const webSearchSchema = Type.Object({
  query: Type.String({
    description: [
      "Search query. Keep it concise.",
      "For recent/current/latest information, include the current year or a concrete date only when it improves retrieval."
    ].join(" ")
  }),
  maxResults: Type.Optional(Type.Number({ description: "Maximum results to return. Defaults to the configured webSearch.maxResults." })),
  engine: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("duckduckgo"),
    Type.Literal("anysearch"),
    Type.Literal("brave"),
    Type.Literal("tavily"),
    Type.Literal("exa"),
    Type.Literal("serper"),
    Type.Literal("baidu"),
    Type.Literal("baidu_fast"),
    Type.Literal("baidu_web"),
    Type.Literal("ark"),
    Type.Literal("grok"),
    Type.Literal("bocha")
  ])),
  route: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("china"),
    Type.Literal("global"),
    Type.Literal("official_docs"),
    Type.Literal("research")
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
    "- Prefer route=\"auto\" and engine=\"auto\" unless the user asks for a specific region, source type, or engine.",
    "- Override route only when the intent is explicit: route=\"china\" for China-local sources, route=\"global\" for global web sources, route=\"official_docs\" for official docs/API/release notes, and route=\"research\" for broad research-style queries.",
    "- When engine=\"auto\", Molibot applies the configured engine selection strategy before fallback: priority, random, or round-robin among configured engines.",
    "",
    "IMPORTANT - Use the correct year in search queries:",
    `- The current month is ${monthYear}. Use this year for recent information, documentation, releases, prices, schedules, and current events.`,
    "- Do not mechanically add today's full date to every query. For live prices, rankings, weather, or latest data, prefer concise queries such as \"最新黄金价格\" unless the user explicitly asks for a date-specific result.",
    "- Example: If the user asks for latest framework docs, search for the framework documentation with the current year when needed, not an old year."
  ].join("\n");
}

function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeOptionalLiteral(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const trimmed = String(input).trim();
  if (!trimmed) return undefined;
  const unquoted = trimmed.replace(/^["']+|["']+$/g, "").trim();
  return unquoted || undefined;
}

function normalizeInput(input: any, settings: RuntimeSettings["webSearch"]): WebSearchInput {
  return {
    query: String(input?.query ?? "").trim(),
    maxResults: Math.max(1, Math.min(20, Number(input?.maxResults ?? settings.maxResults) || settings.maxResults)),
    engine: normalizeOptionalLiteral(input?.engine) as WebSearchInput["engine"],
    route: normalizeOptionalLiteral(input?.route) as WebSearchInput["route"],
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

function createSearchId(): string {
  return `search_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildCitations(results: WebSearchResult[]): WebSearchCitation[] {
  return results.map((result, index) => ({
    id: `c${index + 1}`,
    index: index + 1,
    title: result.title,
    url: result.url,
    ...(result.snippet ? { snippet: result.snippet } : {}),
    ...(result.siteName ? { siteName: result.siteName } : {}),
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    ...(result.source ? { source: result.source } : {}),
    ...(result.providerRefId !== undefined ? { providerRefId: result.providerRefId } : {})
  }));
}

function attachCitationIds(results: WebSearchResult[], citations: WebSearchCitation[]): WebSearchResult[] {
  return results.map((result, index) => ({
    ...result,
    citationId: citations[index]?.id
  }));
}

function metadataFor(
  providerResult: WebSearchProviderResult | undefined,
  results: WebSearchResult[],
  summarySource: WebSearchMetadata["summarySource"]
): WebSearchMetadata {
  return {
    searchedAt: new Date().toISOString(),
    resultCount: results.length,
    summarySource,
    ...(providerResult?.requestId ? { providerRequestId: providerResult.requestId } : {}),
    ...(providerResult?.usage ? { usage: providerResult.usage } : {})
  };
}

function buildSearchResponse(input: {
  engine: WebSearchEngine | null;
  route: WebSearchResponse["route"];
  query: string;
  providerResult?: WebSearchProviderResult;
  summary: string;
  summarySource: WebSearchMetadata["summarySource"];
  attempts: WebSearchAttempt[];
  fallbackOrder: WebSearchEngine[];
}): WebSearchResponse {
  const rawResults = input.providerResult?.results ?? [];
  const citations = buildCitations(rawResults);
  const results = attachCitationIds(rawResults, citations);
  return {
    id: createSearchId(),
    engine: input.engine,
    route: input.route,
    query: input.query,
    results,
    citations,
    summary: input.summary,
    metadata: metadataFor(input.providerResult, results, input.summarySource),
    diagnostics: { attempts: input.attempts, fallbackOrder: input.fallbackOrder }
  };
}

export async function runWebSearch(
  rawInput: unknown,
  settings: RuntimeSettings["webSearch"],
  signal?: AbortSignal,
  _timezone?: string
): Promise<WebSearchResponse> {
  const input = normalizeInput(rawInput, settings);
  if (!settings.enabled) throw new Error("Built-in web search is disabled in settings.");
  if (!input.query) throw new Error("Search query is required.");
  const providerInput: WebSearchInput = { ...input };

  const route = inferWebSearchRoute(input, settings);
  const engines = resolveWebSearchEngines(input, settings, route);
  const attempts: WebSearchAttempt[] = [];

  for (const engine of engines) {
    const provider = WEB_SEARCH_PROVIDERS[engine];
    const engineSettings = settings.engines[engine];
    if (!provider || !engineSettings?.enabled) {
      attempts.push({ engine, route, ok: false, skipped: true, error: "engine_disabled" });
      continue;
    }
    if (engine !== "duckduckgo" && engine !== "anysearch" && !engineSettings.apiKey.trim()) {
      attempts.push({ engine, route, ok: false, skipped: true, error: "missing_api_key" });
      continue;
    }

    let requestLog: WebSearchRequestLog | undefined;
    const runAttempt = async (timeoutMs: number) => {
      const requests: WebSearchRequestLog[] = [];
      return withTimeout(timeoutMs, signal, (attemptSignal) =>
        provider.search({ ...providerInput, query: providerInput.query }, {
          settings,
          fetch: globalThis.fetch,
          signal: attemptSignal,
          requests
        })
      ).finally(() => {
        requestLog = requests[requests.length - 1];
      });
    };

    try {
      const providerResult = await runAttempt(settings.timeoutMs);
      const { results, answer } = providerResult;
      attempts.push({ engine, route, ok: true, resultCount: results.length, timeoutMs: settings.timeoutMs, request: requestLog });
      if (results.length > 0) {
        return buildSearchResponse({
          engine,
          route,
          query: input.query,
          providerResult,
          summary: answer || summarize(results),
          summarySource: answer ? "provider" : "fallback",
          attempts,
          fallbackOrder: engines
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ engine, route, ok: false, error: message, timeoutMs: settings.timeoutMs, request: requestLog });
      if (isAbortError(error) && settings.retryTimeoutMs > settings.timeoutMs) {
        try {
          const providerResult = await runAttempt(settings.retryTimeoutMs);
          const { results, answer } = providerResult;
          attempts.push({ engine, route, ok: true, resultCount: results.length, timeoutMs: settings.retryTimeoutMs, request: requestLog });
          if (results.length > 0) {
            return buildSearchResponse({
              engine,
              route,
              query: input.query,
              providerResult,
              summary: answer || summarize(results),
              summarySource: answer ? "provider" : "fallback",
              attempts,
              fallbackOrder: engines
            });
          }
        } catch (retryError) {
          attempts.push({
            engine,
            route,
            ok: false,
            error: retryError instanceof Error ? retryError.message : String(retryError),
            timeoutMs: settings.retryTimeoutMs,
            request: requestLog
          });
        }
      }
    }
  }

  const hasSuccessfulAttempt = attempts.some((a) => a.ok && !a.skipped);
  const summary = hasSuccessfulAttempt
    ? "No search results found."
    : "No configured search engine returned results.";

  return buildSearchResponse({
    engine: null,
    route,
    query: input.query,
    providerResult: { results: [] },
    summary,
    summarySource: "none",
    attempts,
    fallbackOrder: engines
  });
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
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult<WebSearchResponse>> => {
      const currentSettings = options.getSettings();
      const result = await runWebSearch(params, currentSettings.webSearch, signal, currentSettings.timezone);
      return {
        content: [{ type: "text", text: result.summary }],
        details: result
      };
    }
  };
}

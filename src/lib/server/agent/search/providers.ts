import type { WebSearchEngine, WebSearchInput, WebSearchProvider, WebSearchProviderContext, WebSearchProviderResult, WebSearchRequestLog, WebSearchResult } from "$lib/server/agent/search/types.js";
import { WEB_SEARCH_DEFAULT_BASE_URLS } from "$lib/shared/webSearchDefaults.js";

function engineConfig(context: WebSearchProviderContext, engine: WebSearchEngine) {
  return context.settings.engines[engine];
}

function requireApiKey(context: WebSearchProviderContext, engine: WebSearchEngine): string {
  const apiKey = engineConfig(context, engine)?.apiKey?.trim();
  if (!apiKey) throw new Error(`${engine} API key is not configured`);
  return apiKey;
}

function withDomains(query: string, input: WebSearchInput): string {
  const include = (input.includeDomains ?? []).map((domain) => `site:${domain}`).join(" ");
  const exclude = (input.excludeDomains ?? []).map((domain) => `-site:${domain}`).join(" ");
  return [query, include, exclude].filter(Boolean).join(" ").trim();
}

function limitResults(results: WebSearchResult[], maxResults?: number): WebSearchResult[] {
  const limit = Math.max(1, Math.min(20, Number(maxResults ?? 5) || 5));
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const result of results) {
    const url = String(result.url ?? "").trim();
    const title = String(result.title ?? "").trim();
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      snippet: String(result.snippet ?? "").trim(),
      source: result.source,
      publishedAt: result.publishedAt,
      siteName: result.siteName,
      favicon: result.favicon,
      displayUrl: result.displayUrl,
      providerRefId: result.providerRefId
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function singleSummaryResult(
  title: string,
  url: string,
  snippet: unknown,
  source: WebSearchResult["source"]
): WebSearchResult[] {
  const text = String(snippet ?? "").trim();
  return text ? [{ title, url, snippet: text, source }] : [];
}

function resolveChatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function logRequest(context: WebSearchProviderContext, request: WebSearchRequestLog): void {
  context.requests?.push(request);
}

async function duckDuckGoSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", withDomains(input.query, input));
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");
  logRequest(context, { method: "GET", url: url.toString() });
  const data = await readJson(await context.fetch(url.toString(), { signal: context.signal } as RequestInit));
  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  const results: WebSearchResult[] = [];
  if (data.AbstractURL && data.AbstractText) {
    results.push({
      title: String(data.Heading || data.AbstractSource || "DuckDuckGo result"),
      url: String(data.AbstractURL),
      snippet: String(data.AbstractText),
      source: "duckduckgo"
    });
  }
  for (const item of related) {
    const rows = Array.isArray(item.Topics) ? item.Topics : [item];
    for (const row of rows) {
      if (!row?.FirstURL || !row?.Text) continue;
      results.push({
        title: String(row.Text).split(" - ")[0].slice(0, 120),
        url: String(row.FirstURL),
        snippet: String(row.Text),
        source: "duckduckgo"
      });
    }
  }
  return { results: limitResults(results, input.maxResults) };
}

async function anySearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const config = engineConfig(context, "anysearch");
  const apiKey = config?.apiKey?.trim();
  const url = config?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.anysearch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = {
    query: withDomains(input.query, input),
    max_results: Math.max(1, Math.min(20, input.maxResults ?? 5))
  };
  logRequest(context, {
    method: "POST",
    url,
    headers: apiKey ? { "Content-Type": "application/json", Authorization: "Bearer <redacted>" } : headers,
    body
  });
  const data = await readJson(await context.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: context.signal
  } as RequestInit));
  if (data.code !== 0) throw new Error(`AnySearch API error: ${String(data.message || data.code || "unknown error")}`);
  const rows = Array.isArray(data.data?.results) ? data.data.results : [];
  return {
    requestId: typeof data.data?.metadata?.request_id === "string" ? data.data.metadata.request_id : undefined,
    results: limitResults(rows.map((row: any) => ({
      title: row.title,
      url: row.url,
      snippet: row.snippet || row.content,
      source: "anysearch"
    })), input.maxResults)
  };
}

async function braveSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "brave");
  const url = new URL(`${engineConfig(context, "brave")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.brave}`);
  url.searchParams.set("q", withDomains(input.query, input));
  url.searchParams.set("count", String(Math.max(1, Math.min(20, input.maxResults ?? 5))));
  url.searchParams.set("extra_snippets", "true");
  logRequest(context, {
    method: "GET",
    url: url.toString(),
    headers: { "X-Subscription-Token": "<redacted>", Accept: "application/json" }
  });
  const data = await readJson(await context.fetch(url.toString(), {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    signal: context.signal
  } as RequestInit));
  const rows = Array.isArray(data.web?.results) ? data.web.results : [];
  return { results: limitResults(rows.map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.description,
    source: "brave",
    publishedAt: row.page_age || row.age,
    siteName: row.profile?.name,
    favicon: row.profile?.img
  })), input.maxResults) };
}

async function tavilySearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "tavily");
  const url = engineConfig(context, "tavily")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.tavily;
  const body = {
    query: withDomains(input.query, input),
    max_results: Math.max(1, Math.min(20, input.maxResults ?? 5)),
    include_answer: true
  };
  logRequest(context, {
    method: "POST",
    url,
    headers: { "Content-Type": "application/json", Authorization: "Bearer <redacted>" },
    body
  });
  const data = await readJson(await context.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: context.signal
  } as RequestInit));
  return {
    answer: typeof data.answer === "string" ? data.answer : undefined,
    requestId: typeof data.request_id === "string" ? data.request_id : undefined,
    usage: data.usage?.credits !== undefined ? { credits: Number(data.usage.credits) } : undefined,
    results: limitResults((Array.isArray(data.results) ? data.results : []).map((row: any) => ({
      title: row.title,
      url: row.url,
      snippet: row.content,
      source: "tavily",
      publishedAt: row.published_date,
      favicon: row.favicon
    })), input.maxResults)
  };
}

async function exaSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "exa");
  const data = await readJson(await context.fetch(engineConfig(context, "exa")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.exa, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query: withDomains(input.query, input),
      numResults: Math.max(1, Math.min(20, input.maxResults ?? 5)),
      contents: { text: { maxCharacters: 500 } }
    }),
    signal: context.signal
  } as RequestInit));
  return { results: limitResults((Array.isArray(data.results) ? data.results : []).map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.text || row.highlight || "",
    source: "exa",
    publishedAt: row.publishedDate
  })), input.maxResults) };
}

async function serperSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "serper");
  const data = await readJson(await context.fetch(engineConfig(context, "serper")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.serper, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      q: withDomains(input.query, input),
      num: Math.max(1, Math.min(20, input.maxResults ?? 5))
    }),
    signal: context.signal
  } as RequestInit));
  return { results: limitResults((Array.isArray(data.organic) ? data.organic : []).map((row: any) => ({
    title: row.title,
    url: row.link,
    snippet: row.snippet,
    source: "serper",
    publishedAt: row.date
  })), input.maxResults) };
}

async function baiduSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "baidu");
  const data = await readJson(await context.fetch(engineConfig(context, "baidu")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.baidu, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appbuilder-Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: withDomains(input.query, input) }],
      stream: false,
      search_source: "baidu_search_v1"
    }),
    signal: context.signal
  } as RequestInit));
  const rows = (data.references || data.search_results || [])
    .filter((r: any) => !r.type || r.type === "web");
  const content = data.choices?.[0]?.message?.content;
  const results = rows.length > 0
    ? limitResults(rows.map((row: any) => ({
        title: row.title || row.name,
        url: row.url || row.link,
        snippet: row.content || row.snippet || row.summary,
        source: "baidu",
        publishedAt: row.date || row.published_at
      })), input.maxResults)
    : content
      ? [{ title: "Baidu AI Search", url: "https://cloud.baidu.com/product/qianfan", snippet: String(content), source: "baidu" }]
      : [];
  if (results.length === 0) console.log("Baidu Search - no results:", { query: input.query });
  return {
    results,
    answer: content ? String(content) : undefined,
    requestId: typeof data.request_id === "string" ? data.request_id : undefined,
    usage: data.usage ? {
      inputTokens: Number(data.usage.prompt_tokens ?? 0) || undefined,
      outputTokens: Number(data.usage.completion_tokens ?? 0) || undefined,
      totalTokens: Number(data.usage.total_tokens ?? 0) || undefined
    } : undefined
  };
}

async function baiduFastSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "baidu_fast");
  const data = await readJson(await context.fetch(engineConfig(context, "baidu_fast")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.baidu_fast, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appbuilder-Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: withDomains(input.query, input) }],
      stream: false
    }),
    signal: context.signal
  } as RequestInit));
  const rows = (data.references || [])
    .filter((r: any) => !r.type || r.type === "web");
  const content = data.choices?.[0]?.message?.content;
  if (Array.isArray(rows) && rows.length > 0) {
    return {
      answer: content ? String(content) : undefined,
      requestId: typeof data.request_id === "string" ? data.request_id : undefined,
      results: limitResults(rows.map((row: any) => ({
        title: row.title || row.name,
        url: row.url || row.link,
        snippet: row.content || row.snippet || row.summary,
        source: "baidu_fast",
        publishedAt: row.date || row.published_at,
        siteName: row.website || row.web_anchor,
        favicon: row.icon,
        providerRefId: row.id
      })), input.maxResults)
    };
  }
  return {
    requestId: typeof data.request_id === "string" ? data.request_id : undefined,
    results: singleSummaryResult(
      "Baidu Fast Search",
      "https://cloud.baidu.com/product/qianfan",
      content,
      "baidu_fast"
    ),
    answer: content ? String(content) : undefined
  };
}

async function baiduWebSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "baidu_web");
  const data = await readJson(await context.fetch(engineConfig(context, "baidu_web")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.baidu_web, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appbuilder-Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: input.query }],
      search_source: "baidu_search_v2",
      resource_type_filter: [{
        type: "web",
        top_k: Math.max(1, Math.min(20, input.maxResults ?? 5))
      }]
    }),
    signal: context.signal
  } as RequestInit));
  const rows = (data.references || [])
    .filter((r: any) => !r.type || r.type === "web");
  return {
    requestId: typeof data.request_id === "string" ? data.request_id : undefined,
    results: limitResults((Array.isArray(rows) ? rows : []).map((row: any) => ({
      title: row.title || row.name,
      url: row.url || row.link,
      snippet: row.content || row.snippet || row.summary,
      source: "baidu_web",
      publishedAt: row.date || row.published_at,
      siteName: row.website || row.web_anchor,
      favicon: row.icon,
      providerRefId: row.id
    })), input.maxResults)
  };
}

async function arkSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "ark");
  const data = await readJson(await context.fetch(engineConfig(context, "ark")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.ark, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "bot-20260310183451-lpk6v",
      stream: false,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: input.query }
      ]
    }),
    signal: context.signal
  } as RequestInit));
  return { results: singleSummaryResult(
    "Ark Bot Search",
    "https://www.volcengine.com/product/ark",
    data.choices?.[0]?.message?.content,
    "ark"
  ) };
}

async function grokSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "grok");
  const endpoint = resolveChatCompletionsEndpoint(engineConfig(context, "grok")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.grok);
  const data = await readJson(await context.fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-4.20-fast",
      stream: false,
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_tokens: 512,
      messages: [
        {
          role: "system",
          content: "You are a web search assistant. Keep the answer concise and avoid fabricated links."
        },
        { role: "user", content: input.query }
      ]
    }),
    signal: context.signal
  } as RequestInit));
  const citations = data.search_results || data.search_sources || data.citations || [];
  if (Array.isArray(citations) && citations.length > 0) {
    return { results: limitResults(citations.map((row: any) => ({
      title: row.title || row.name || row.url || "Grok search result",
      url: row.url || row.link,
      snippet: row.snippet || row.summary || row.content,
      source: "grok",
      publishedAt: row.date || row.published_at
    })), input.maxResults) };
  }
  return { results: singleSummaryResult(
    "Grok Search",
    "https://x.ai",
    data.choices?.[0]?.message?.content,
    "grok"
  ) };
}

async function bochaSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult> {
  const apiKey = requireApiKey(context, "bocha");
  const data = await readJson(await context.fetch(engineConfig(context, "bocha")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.bocha, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: withDomains(input.query, input),
      freshness: "noLimit",
      summary: true,
      count: Math.max(1, Math.min(20, input.maxResults ?? 5))
    }),
    signal: context.signal
  } as RequestInit));
  const rows = data.data?.webPages?.value || data.webPages?.value || data.results || [];
  return {
    requestId: typeof data.log_id === "string" ? data.log_id : undefined,
    results: limitResults((Array.isArray(rows) ? rows : []).map((row: any) => ({
      title: row.name || row.title,
      url: row.url,
      displayUrl: row.displayUrl,
      snippet: row.summary || row.snippet,
      source: "bocha",
      publishedAt: row.datePublished,
      siteName: row.siteName,
      favicon: row.siteIcon,
      providerRefId: row.id
    })), input.maxResults)
  };
}

export const WEB_SEARCH_PROVIDERS: Record<WebSearchEngine, WebSearchProvider> = {
  duckduckgo: { id: "duckduckgo", search: duckDuckGoSearch },
  anysearch: { id: "anysearch", search: anySearch },
  brave: { id: "brave", search: braveSearch },
  tavily: { id: "tavily", search: tavilySearch },
  exa: { id: "exa", search: exaSearch },
  serper: { id: "serper", search: serperSearch },
  baidu: { id: "baidu", search: baiduSearch },
  baidu_fast: { id: "baidu_fast", search: baiduFastSearch },
  baidu_web: { id: "baidu_web", search: baiduWebSearch },
  ark: { id: "ark", search: arkSearch },
  grok: { id: "grok", search: grokSearch },
  bocha: { id: "bocha", search: bochaSearch }
};

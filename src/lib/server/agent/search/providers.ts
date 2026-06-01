import type { WebSearchEngine, WebSearchInput, WebSearchProvider, WebSearchProviderContext, WebSearchResult } from "$lib/server/agent/search/types.js";
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
      publishedAt: result.publishedAt
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

async function duckDuckGoSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", withDomains(input.query, input));
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");
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
  return limitResults(results, input.maxResults);
}

async function braveSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
  const apiKey = requireApiKey(context, "brave");
  const url = new URL(`${engineConfig(context, "brave")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.brave}`);
  url.searchParams.set("q", withDomains(input.query, input));
  url.searchParams.set("count", String(Math.max(1, Math.min(20, input.maxResults ?? 5))));
  const data = await readJson(await context.fetch(url.toString(), {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    signal: context.signal
  } as RequestInit));
  const rows = Array.isArray(data.web?.results) ? data.web.results : [];
  return limitResults(rows.map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.description,
    source: "brave",
    publishedAt: row.age
  })), input.maxResults);
}

async function tavilySearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
  const apiKey = requireApiKey(context, "tavily");
  const data = await readJson(await context.fetch(engineConfig(context, "tavily")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.tavily, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: withDomains(input.query, input),
      max_results: Math.max(1, Math.min(20, input.maxResults ?? 5)),
      include_answer: false
    }),
    signal: context.signal
  } as RequestInit));
  return limitResults((Array.isArray(data.results) ? data.results : []).map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.content,
    source: "tavily",
    publishedAt: row.published_date
  })), input.maxResults);
}

async function exaSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
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
  return limitResults((Array.isArray(data.results) ? data.results : []).map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.text || row.highlight || "",
    source: "exa",
    publishedAt: row.publishedDate
  })), input.maxResults);
}

async function serperSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
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
  return limitResults((Array.isArray(data.organic) ? data.organic : []).map((row: any) => ({
    title: row.title,
    url: row.link,
    snippet: row.snippet,
    source: "serper",
    publishedAt: row.date
  })), input.maxResults);
}

async function baiduSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
  const apiKey = requireApiKey(context, "baidu");
  const data = await readJson(await context.fetch(engineConfig(context, "baidu")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.baidu, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appbuilder-Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: withDomains(input.query, input) }],
      search_source: "baidu_search_v1"
    }),
    signal: context.signal
  } as RequestInit));
  const rows = data.references || data.search_results || data.results || [];
  if (Array.isArray(rows) && rows.length > 0) {
    return limitResults(rows.map((row: any) => ({
      title: row.title || row.name,
      url: row.url || row.link,
      snippet: row.snippet || row.summary || row.content,
      source: "baidu",
      publishedAt: row.date || row.published_at
    })), input.maxResults);
  }
  const content = data.choices?.[0]?.message?.content;
  return content ? [{
    title: "Baidu AI Search",
    url: "https://cloud.baidu.com/product/qianfan",
    snippet: String(content),
    source: "baidu"
  }] : [];
}

async function bochaSearch(input: WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]> {
  const apiKey = requireApiKey(context, "bocha");
  const data = await readJson(await context.fetch(engineConfig(context, "bocha")?.baseUrl || WEB_SEARCH_DEFAULT_BASE_URLS.bocha, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: withDomains(input.query, input),
      count: Math.max(1, Math.min(20, input.maxResults ?? 5))
    }),
    signal: context.signal
  } as RequestInit));
  const rows = data.data?.webPages?.value || data.webPages?.value || data.results || [];
  return limitResults((Array.isArray(rows) ? rows : []).map((row: any) => ({
    title: row.name || row.title,
    url: row.url,
    snippet: row.snippet || row.summary,
    source: "bocha",
    publishedAt: row.datePublished
  })), input.maxResults);
}

export const WEB_SEARCH_PROVIDERS: Record<WebSearchEngine, WebSearchProvider> = {
  duckduckgo: { id: "duckduckgo", search: duckDuckGoSearch },
  brave: { id: "brave", search: braveSearch },
  tavily: { id: "tavily", search: tavilySearch },
  exa: { id: "exa", search: exaSearch },
  serper: { id: "serper", search: serperSearch },
  baidu: { id: "baidu", search: baiduSearch },
  bocha: { id: "bocha", search: bochaSearch }
};

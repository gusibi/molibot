import type { WebSearchEngine, WebSearchInput, WebSearchRouteMode } from "$lib/server/agent/search/types.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const CHINESE_RE = /[\u3400-\u9fff]/;
const RECENT_RE = /\b(today|latest|recent|breaking|news|now|this week)\b/i;
const CHINESE_NEWS_RE = /(新闻|热点|今日|今天|最新|近期|最近|时事|快讯|发生)/;
const INTERNATIONAL_RE = /(国际|海外|国外|美国|欧洲|日本|韩国|俄乌|中东|global|international|overseas|foreign|us|europe|japan|korea)/i;

export const WEB_SEARCH_ROUTE_ORDERS: Record<WebSearchRouteMode, WebSearchEngine[]> = {
  auto: ["duckduckgo"],
  domestic_news: ["baidu", "bocha", "duckduckgo"],
  international_news: ["brave", "tavily", "exa", "serper", "duckduckgo"],
  chinese_general: ["baidu", "bocha", "duckduckgo"],
  global_general: ["brave", "tavily", "exa", "serper", "duckduckgo"]
};

export function inferWebSearchRoute(query: string, requestedRoute: WebSearchInput["route"], settings: WebSearchSettings): WebSearchRouteMode {
  if (requestedRoute && requestedRoute !== "auto") return requestedRoute;
  if (settings.defaultRoute !== "auto") return settings.defaultRoute;
  const isChinese = CHINESE_RE.test(query);
  const isNewsLike = CHINESE_NEWS_RE.test(query) || RECENT_RE.test(query);
  if (isChinese && isNewsLike && !INTERNATIONAL_RE.test(query)) return "domestic_news";
  if (isNewsLike && INTERNATIONAL_RE.test(query)) return "international_news";
  if (isChinese) return "chinese_general";
  return "global_general";
}

export function resolveWebSearchEngines(
  input: WebSearchInput,
  settings: WebSearchSettings,
  route: WebSearchRouteMode
): WebSearchEngine[] {
  const requestedEngine = input.engine ?? settings.defaultEngine;
  if (requestedEngine && requestedEngine !== "auto") return [requestedEngine];
  const routeOrder = WEB_SEARCH_ROUTE_ORDERS[route] ?? WEB_SEARCH_ROUTE_ORDERS.global_general;
  return routeOrder.filter((engine) => settings.engines[engine]?.enabled);
}

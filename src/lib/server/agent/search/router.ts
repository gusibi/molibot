import type { WebSearchEngine, WebSearchInput, WebSearchRouteMode } from "$lib/server/agent/search/types.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const OFFICIAL_DOCS_RE = /\b(api|changelog|docs?|documentation|github|npm|pypi|release notes?|sdk)\b|官方文档|开发文档|接口文档|版本说明|发布日志/i;
const CHINA_LOCAL_RE = /(^|[^\w])(?:china|chinese|cn)([^\w]|$)|中国|国内|本地|大陆|A股|港股|微信|微博|抖音|小红书|知乎|百度|政策|监管|人民币|沪深|上证|深证|北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|长沙|郑州|青岛|宁波|厦门|福州/i;
const GLOBAL_RE = /\b(global|international|overseas|foreign|worldwide|openai|github|sec|fda|eu|europe|japan|korea|us|usa|united states)\b|国际|海外|国外|美国|欧洲|日本|韩国|俄乌|中东/i;
const roundRobinCursors = new Map<WebSearchRouteMode, number>();

export const WEB_SEARCH_ROUTE_ORDERS: Record<WebSearchRouteMode, WebSearchEngine[]> = {
  auto: ["anysearch", "baidu_fast", "brave", "serper", "tavily", "exa", "duckduckgo"],
  china: ["anysearch", "baidu_web", "baidu_fast", "baidu", "bocha", "ark", "duckduckgo"],
  global: ["anysearch", "tavily", "brave", "serper", "exa", "grok", "duckduckgo"],
  official_docs: ["anysearch", "brave", "exa", "serper", "duckduckgo"],
  research: ["anysearch", "tavily", "exa", "brave", "serper", "grok", "duckduckgo"]
};

export function inferWebSearchRoute(input: WebSearchInput, settings: WebSearchSettings): WebSearchRouteMode {
  if (input.route && input.route !== "auto") return input.route;
  if (settings.defaultRoute !== "auto") return settings.defaultRoute;

  const query = input.query.trim();
  if ((input.includeDomains?.length ?? 0) > 0 || OFFICIAL_DOCS_RE.test(query)) return "official_docs";
  if (GLOBAL_RE.test(query)) return "global";
  if (CHINA_LOCAL_RE.test(query)) return "china";
  return "global";
}

export function resolveWebSearchEngines(
  input: WebSearchInput,
  settings: WebSearchSettings,
  route: WebSearchRouteMode
): WebSearchEngine[] {
  const requestedEngine = input.engine ?? settings.defaultEngine;
  if (requestedEngine && requestedEngine !== "auto") return [requestedEngine];
  const routeOrder = WEB_SEARCH_ROUTE_ORDERS[route] ?? WEB_SEARCH_ROUTE_ORDERS.global;
  const engines = routeOrder.filter((engine) => {
    const engineSettings = settings.engines[engine];
    return Boolean(engineSettings?.enabled && (engine === "duckduckgo" || engine === "anysearch" || engineSettings.apiKey.trim()));
  });
  if (engines.length <= 1 || settings.engineSelectionStrategy === "priority") return engines;
  if (settings.engineSelectionStrategy === "random") return rotateEngines(engines, Math.floor(Math.random() * engines.length));

  const cursor = roundRobinCursors.get(route) ?? 0;
  roundRobinCursors.set(route, cursor + 1);
  return rotateEngines(engines, cursor % engines.length);
}

function rotateEngines(engines: WebSearchEngine[], startIndex: number): WebSearchEngine[] {
  return engines.slice(startIndex).concat(engines.slice(0, startIndex));
}

export function resetWebSearchEngineSelectionStateForTest(): void {
  roundRobinCursors.clear();
}

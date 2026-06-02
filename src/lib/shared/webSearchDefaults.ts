export const WEB_SEARCH_DEFAULT_BASE_URLS = {
  brave: "https://api.search.brave.com/res/v1/web/search",
  tavily: "https://api.tavily.com/search",
  exa: "https://api.exa.ai/search",
  serper: "https://google.serper.dev/search",
  baidu: "https://qianfan.baidubce.com/v2/ai_search/chat/completions",
  baidu_fast: "https://qianfan.baidubce.com/v2/ai_search/web_summary",
  baidu_web: "https://qianfan.baidubce.com/v2/ai_search/web_search",
  ark: "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  bocha: "https://api.bochaai.com/v1/web-search"
} as const;

export type WebSearchBaseUrlEngine = keyof typeof WEB_SEARCH_DEFAULT_BASE_URLS;

# Web Search Tool 增量优化 TD

## 1. 结论

当前 `webSearch` 已经有可运行的 Agent 层实现：

- 工具入口：`src/lib/server/agent/search/webSearchTool.ts`
- Provider adapter：`src/lib/server/agent/search/providers.ts`
- 路由选择：`src/lib/server/agent/search/router.ts`
- 类型契约：`src/lib/server/agent/search/types.ts`
- Settings 配置：`RuntimeSettings.webSearch`

所以这次优化不应该重写一套新的 SearchOrchestrator，也不应该一次性引入流式搜索、图片、视频、字段级 grounding。正确方向是：**在现有实现上，把工具输出从“摘要文本 + 搜索结果列表”升级成 Agent 可安全消费的 evidence package**。

第一阶段目标：

```txt
保持现有工具可用
+ 增加 citations
+ 增加 metadata
+ 让每条 result 能稳定映射到 citation
+ 保留 provider diagnostics 供排障使用
```

## 2. 背景和问题

当前 `WebSearchResponse` 结构较轻：

```ts
export interface WebSearchResponse {
  engine: WebSearchEngine | null;
  route: WebSearchRouteMode;
  query: string;
  results: WebSearchResult[];
  summary: string;
  diagnostics: {
    attempts: WebSearchAttempt[];
    fallbackOrder: WebSearchEngine[];
  };
}
```

这能满足“搜索并返回文本”，但对 Agent 最终回答不够严格：

1. `summary` 是纯字符串，无法表达它由哪些网页支撑。
2. `results` 没有稳定 citation id，最终回答只能临时拼 URL。
3. Provider 的 `request_id`、`usage`、站点名、favicon、发布时间等信息没有统一落位。
4. 百度 `web_summary`、Tavily 这类 provider 能返回综合 answer，但当前接口没有区分 provider answer 和基于 results 拼出来的 fallback summary。
5. `diagnostics` 更适合排障，不适合直接作为 Agent 使用的引用结构。

## 3. 设计原则

1. **公共逻辑留在 Agent 层**
   Web Search 是共享 Agent 工具，不属于 Channel 层。Channel 不应知道搜索 provider、fallback、citation 规则。

2. **增量改造现有结构**
   当前代码已经有 `webSearchTool -> providers -> router`。本 TD 只在这个结构上增强类型和标准化逻辑。

3. **Provider 返回材料，Tool 返回证据包**
   Provider adapter 负责调用 API 和初步字段映射；`runWebSearch` 负责补 citation、summary fallback、metadata、diagnostics。

4. **第一版 citation 粒度到 source**
   每条标准化 result 生成一个 citation。chunk/sentence 级引用放后续，不进入本轮实施。

5. **保持工具输入兼容**
   继续使用现有 camelCase 参数：`query`、`maxResults`、`engine`、`route`、`includeDomains`、`excludeDomains`。不要改成 `count`、`provider`、`include_domains`。

## 4. 非目标

本轮不做：

- 不新增 Channel 层逻辑。
- 不重写 SearchOrchestrator。
- 不实现 SSE/streaming 搜索事件。
- 不实现图片、视频、academic、shopping 等新搜索类型。
- 不实现网页抓取、PDF 解析或全文 RAG。
- 不引入额外 summarizer 工具或二次 LLM 总结。
- 不把 provider 原始 response 默认暴露给 Agent。

这些能力可以作为后续阶段设计。

## 5. 推荐目标类型

### 5.1 输入类型

保持现有输入，只补充字段说明，不破坏调用方：

```ts
export interface WebSearchInput {
  query: string;
  maxResults?: number;
  engine?: WebSearchEngine | "auto";
  route?: WebSearchRouteMode;
  includeDomains?: string[];
  excludeDomains?: string[];
}
```

后续如果要支持时间范围、安全搜索、语言/地区，建议新增 camelCase 字段：

```ts
freshness?: "day" | "week" | "month" | "year" | "noLimit" | {
  startDate?: string;
  endDate?: string;
};
language?: string;
country?: string;
safeSearch?: "off" | "moderate" | "strict";
```

这些字段不进入第一阶段。

### 5.2 输出类型

第一阶段推荐把 `WebSearchResponse` 改成：

```ts
export interface WebSearchResponse {
  id: string;
  engine: WebSearchEngine | null;
  route: WebSearchRouteMode;
  query: string;
  results: WebSearchResult[];
  citations: WebSearchCitation[];
  summary: string;
  metadata: WebSearchMetadata;
  diagnostics: {
    attempts: WebSearchAttempt[];
    fallbackOrder: WebSearchEngine[];
  };
}
```

这里保留 `summary: string`，原因是当前 `createWebSearchTool()` 已经把它作为 tool text content 返回：

```ts
content: [{ type: "text", text: result.summary }]
```

如果第一阶段就把 `summary` 改成对象，会影响工具消费者和测试。更稳的做法是先新增 `summaryCitationIds` 或在 metadata 中标明 summary 来源，后续再对象化。

### 5.3 Result 类型

```ts
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: WebSearchEngine | string;
  publishedAt?: string;
  siteName?: string;
  favicon?: string;
  displayUrl?: string;
  citationId?: string;
}
```

兼容现有字段，只新增可选字段。

### 5.4 Citation 类型

```ts
export interface WebSearchCitation {
  id: string;          // c1, c2, c3
  index: number;       // 1, 2, 3
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
  publishedAt?: string;
  source?: WebSearchEngine | string;
  providerRefId?: string | number;
}
```

第一阶段规则：

- `citations.length` 通常等于 `results.length`。
- `results[n].citationId` 指向 `citations[n].id`。
- citation id 由工具内部生成，不直接使用百度 `references[].id`。
- provider 原始 id 放到 `providerRefId`。

### 5.5 Metadata 类型

```ts
export interface WebSearchMetadata {
  searchedAt: string;
  resultCount: number;
  summarySource: "provider" | "generated" | "fallback" | "none";
  providerRequestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    credits?: number;
    costUsd?: number;
  };
}
```

`summarySource` 语义：

- `provider`：来自百度 `choices[0].message.content`、Tavily `answer` 等 provider answer。
- `generated`：后续如果接入自有 summarizer，则使用这个值。
- `fallback`：当前 `summarize(results)` 拼接出的列表摘要。
- `none`：没有可用摘要。

## 6. Provider 映射

当前 engine id 必须以代码为准：

```ts
type WebSearchEngineId =
  | "duckduckgo"
  | "brave"
  | "tavily"
  | "exa"
  | "serper"
  | "baidu"
  | "baidu_fast"
  | "baidu_web"
  | "ark"
  | "grok"
  | "bocha";
```

不要在 TD 或实现里新增未接入的 `"baidu_web_summary"`、`"baidu_web_search"`、`"baidu_deep_search"`。如果需要解释百度 API 类型，使用下面的映射：

| 当前 engine | API 类型 | 默认 endpoint | 说明 |
| --- | --- | --- | --- |
| `baidu_fast` | 百度 `web_summary` | `/v2/ai_search/web_summary` | 有 `choices.message.content` 和 `references` |
| `baidu_web` | 百度 `web_search` | `/v2/ai_search/web_search` | 主要返回 `references` |
| `baidu` | 百度 chat completions slow search | `/v2/ai_search/chat/completions` | 有 answer、references、usage |

### 6.1 百度 `baidu_fast`

文档显示 `web_summary` 可以返回：

- `choices[0].message.content`
- `references[]`
- `request_id`

当前实现有一个需要修正的点：当 `references` 存在时，只返回 `results`，没有把 `choices[0].message.content` 作为 `answer` 返回。第一阶段应补上：

```ts
return {
  answer: content ? String(content) : undefined,
  results,
  requestId: data.request_id
}
```

### 6.2 百度 `baidu_web`

`web_search` 更像纯检索：

- `references[] -> results + citations`
- `request_id -> metadata.providerRequestId`
- 没有 summary 时，使用 `summarize(results)` 作为 fallback summary

### 6.3 百度 `baidu`

chat completions slow search：

- `choices[0].message.content -> provider answer`
- `references[] -> results + citations`
- `usage -> metadata.usage`
- `request_id -> metadata.providerRequestId`

### 6.4 Tavily

当前实现已经设置 `include_answer: true`。

建议映射：

- `answer -> provider answer`
- `results[].title -> title`
- `results[].url -> url`
- `results[].content -> snippet`
- `results[].published_date -> publishedAt`
- `results[].favicon -> favicon`
- `request_id -> metadata.providerRequestId`
- `usage.credits -> metadata.usage.credits`

### 6.5 Bocha

API 文档中的字段：

- `data.queryContext.originalQuery`
- `data.webPages.totalEstimatedMatches`
- `data.webPages.value[].name`
- `data.webPages.value[].url`
- `data.webPages.value[].displayUrl`
- `data.webPages.value[].snippet`
- `data.webPages.value[].summary`
- `data.webPages.value[].siteName`
- `data.webPages.value[].siteIcon`
- `data.webPages.value[].datePublished`
- `data.webPages.value[].dateLastCrawled`

当前实现只取了 `name/url/snippet/summary/datePublished`。第一阶段可补：

- `displayUrl`
- `siteName`
- `favicon`
- `providerRequestId` 使用 `log_id`

另外请求体建议加上：

```ts
summary: true
freshness: "noLimit"
```

但 `freshness` 最好等统一输入字段设计后再开放给 Agent。

### 6.6 Brave

当前实现使用普通 Web Search，不启用 Brave Summarizer。

第一阶段只保留：

- `web.results[].title`
- `web.results[].url`
- `web.results[].description`
- `web.results[].profile.name -> siteName`
- `web.results[].profile.img -> favicon`
- `web.results[].age/page_age -> publishedAt`

Brave Summarizer 是后续能力，不在第一阶段做。不要把 `summarizer.key` 暴露给 Agent。

### 6.7 Exa

当前实现使用 `/search` + `contents.text.maxCharacters`。

第一阶段只保留：

- `results[].title`
- `results[].url`
- `results[].text -> snippet`
- `results[].publishedDate -> publishedAt`

Exa `output.grounding` 和字段级 citation 作为后续阶段。

### 6.8 Serper

当前实现只映射 organic 结果。

第一阶段可继续保持：

- `organic[].title`
- `organic[].link -> url`
- `organic[].snippet`
- `organic[].date -> publishedAt`

`answerBox`、`knowledgeGraph`、`peopleAlsoAsk` 后续再设计。

## 7. 标准化流程

推荐在 `runWebSearch()` 中形成统一后处理：

```txt
1. normalize input
2. infer route
3. resolve engine fallback order
4. call provider.search()
5. provider returns:
   - results
   - answer?
   - requestId?
   - usage?
6. limit/dedupe valid results
7. generate citations from results
8. attach citationId to results
9. choose summary:
   - provider answer -> summarySource = provider
   - else summarize(results) -> summarySource = fallback
   - else no configured engine returned results
10. return WebSearchResponse
```

`limitResults()` 目前已经做了 title/url 校验、去重和数量限制。可以在它之后统一生成 citations，避免每个 provider 重复实现 citation 逻辑。

## 8. Tool 对 Agent 的呈现

`execute()` 可以继续返回：

```ts
return {
  content: [{ type: "text", text: result.summary }],
  details: result
};
```

这里有一个取舍：是否在 `result.summary` 文本里追加引用提示，避免模型忽略 `details.citations`。例如：

```txt
<summary text>

Sources:
1. Title - https://example.com
2. Title - https://example.org
```

另一种方式是保持 summary 干净，只在工具 description 和 `details.citations` 中提供引用数据。两种方式的取舍：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| summary 内追加 Sources | Agent 更容易照着引用 | summary 不再是纯摘要 |
| 只放 details.citations | 数据更干净 | 部分模型可能忽略 details |

第一阶段建议：**保持 summary 干净，依赖 `details.citations` 和工具 description**。如果后续实测 Agent 经常漏引用，再考虑在 text content 中追加 Sources。

## 9. 错误和 diagnostics

当前行为可以保留：

- 工具禁用：throw `Built-in web search is disabled in settings.`
- 空 query：throw `Search query is required.`
- provider 失败：记录到 `diagnostics.attempts`
- fallback 全失败：返回空 results 和说明性 summary

不建议第一阶段改成完整 `WebSearchErrorResponse`，否则会影响调用方和测试。

但 provider request log 需要继续保证：

- API key 必须 redacted。
- request body 可以记录，但不能包含 secret。
- diagnostics 是排障字段，不作为 citation 来源。

## 10. 实施阶段

### 阶段 1：收紧输出契约

目标：

- 新增 `WebSearchCitation`
- 新增 `WebSearchMetadata`
- `WebSearchResult` 增加 `citationId/siteName/favicon/displayUrl`
- `WebSearchProviderResult` 增加 `requestId/usage`
- `runWebSearch()` 统一生成 citations 和 metadata

验收：

- `webSearchTool.test.ts` 覆盖 citations。
- Tavily request diagnostics 仍 redacted。
- 现有 `summary` 字符串兼容。

### 阶段 2：补 provider 字段映射

目标：

- `baidu_fast` 在有 references 时也返回 provider answer。
- `baidu/baidu_fast/baidu_web` 返回 request id。
- `tavily` 返回 request id、usage、favicon。
- `bocha` 返回 siteName、displayUrl、favicon、log_id。
- `brave` 返回 profile name/img。

验收：

- 每个 provider 的单元测试至少覆盖一个 request/response fixture。
- provider 字段缺失时不抛错。

### 阶段 3：再评估 summary 对象化

只有在阶段 1 和阶段 2 稳定后，再考虑把：

```ts
summary: string
```

升级为：

```ts
summary: {
  text: string;
  source: "provider" | "generated" | "fallback" | "none";
  citationIds: string[];
}
```

为了兼容工具 text content，可以同时提供：

```ts
summaryText: string
summary: WebSearchSummary
```

这个阶段需要重新评估 Agent 消费方式，不建议和阶段 1 混在一起。

## 11. 后续能力池

以下能力暂不进入本 TD 的第一轮实施：

- 时间范围：`freshness/startDate/endDate`
- 地区语言：`country/language`
- 安全搜索：`safeSearch`
- Brave Summarizer 二次请求
- Tavily raw content
- Exa output grounding
- image/video/news/research 搜索类型
- `followups`
- `summary.citedSegments`
- streaming search events
- 自有 LLM summarizer

后续每一项都应该单独判断是否真的服务当前产品，而不是一次性铺开。

## 12. 最终目标形态

最终方向仍然是：

```txt
summary + citations + results + metadata + diagnostics
```

但第一阶段不要追求完整终局模型。现在最重要的是让 Agent 能稳定做到：

1. 搜索。
2. 看懂摘要。
3. 知道摘要背后有哪些来源。
4. 最终回答能列出真实 URL。
5. 排障时能看到 provider、request、fallback 过程。

这就是当前 Web Search Tool 从“可用”走向“可信”的最小可行改造。

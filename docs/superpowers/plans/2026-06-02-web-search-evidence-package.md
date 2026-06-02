# Web Search Evidence Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the built-in `webSearch` Agent tool response from plain summary/results into a source-backed evidence package with citations, metadata, and richer provider field mapping while preserving existing tool input and `summary: string` compatibility.

**Architecture:** Keep the existing Agent-layer structure: `webSearchTool.ts` orchestrates input normalization, routing, fallback, citation generation, summary selection, and response metadata; `providers.ts` remains the only provider adapter file and only maps provider API payloads into normalized provider results. Channel code remains untouched.

**Tech Stack:** TypeScript, SvelteKit server modules, `@sinclair/typebox`, built-in `fetch`, Node built-in test runner via `node --import tsx --test`.

---

## Scope Check

This plan implements only Stage 1 and Stage 2 from `docs/tools/web_search_td.md`:

- Add `citations`, `metadata`, search response ids, and `citationId` result links.
- Preserve existing `summary: string` and tool input parameters.
- Enrich provider mappings for Brave, Tavily, Baidu, and Bocha.
- Keep diagnostics redacted.
- Update project docs after the runtime behavior changes.

This plan does not implement streaming events, image/video search, Exa grounding, Brave Summarizer, raw page content fetching, or summary object migration.

## File Structure

- Modify: `src/lib/server/agent/search/types.ts`
  - Owns normalized search input/output/provider TypeScript contracts.
  - Add citation, metadata, provider usage, provider request id, and enriched result fields.

- Modify: `src/lib/server/agent/search/webSearchTool.ts`
  - Owns orchestration and response finalization.
  - Add response ids, citation generation, metadata generation, and summary source selection.

- Modify: `src/lib/server/agent/search/providers.ts`
  - Owns provider API request/response mapping.
  - Preserve richer provider fields through `limitResults()`.
  - Return `requestId` and `usage` where providers expose them.

- Modify: `src/lib/server/agent/search/webSearchTool.test.ts`
  - Owns focused runtime tests for normalized `webSearch` behavior.
  - Add tests for citations, metadata, provider answer preservation, redacted diagnostics, and enriched provider fields.

- Modify: `features.md`
  - Record delivered source-backed web search evidence package.

- Modify: `prd.md`
  - Mark the web search evidence package requirement as delivered.

- Modify: `CHANGELOG.md`
  - Add high-level release notes for evidence-backed search results.

- Modify: `readme.md`
  - Update Built-In Web Search description to mention citations and metadata.

---

### Task 1: Add Evidence Package Types

**Files:**
- Modify: `src/lib/server/agent/search/types.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Write the failing test for citations and metadata**

Append this test to `src/lib/server/agent/search/webSearchTool.test.ts`:

```ts
test("runWebSearch returns citations, citation-linked results, and fallback metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    web: {
      results: [{
        title: "Example",
        url: "https://example.com",
        description: "Example snippet"
      }]
    }
  }), { status: 200 })) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "example" }, settings);
    assert.match(result.id, /^search_/);
    assert.equal(result.metadata.summarySource, "fallback");
    assert.equal(result.metadata.resultCount, 1);
    assert.equal(typeof result.metadata.searchedAt, "string");
    assert.equal(result.citations.length, 1);
    assert.deepEqual(result.citations[0], {
      id: "c1",
      index: 1,
      title: "Example",
      url: "https://example.com",
      snippet: "Example snippet",
      source: "brave"
    });
    assert.equal(result.results[0].citationId, "c1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because `WebSearchResponse` does not yet have `id`, `metadata`, or `citations`.

- [ ] **Step 3: Extend normalized search types**

Replace the `WebSearchResult`, `WebSearchResponse`, and `WebSearchProviderResult` sections in `src/lib/server/agent/search/types.ts` with this code, and add the new `WebSearchCitation`, `WebSearchUsage`, and `WebSearchMetadata` interfaces between `WebSearchResult` and `WebSearchAttempt`:

```ts
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
  siteName?: string;
  favicon?: string;
  displayUrl?: string;
  citationId?: string;
  providerRefId?: string | number;
}

export interface WebSearchCitation {
  id: string;
  index: number;
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
  publishedAt?: string;
  source?: string;
  providerRefId?: string | number;
}

export interface WebSearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  credits?: number;
  costUsd?: number;
}

export interface WebSearchMetadata {
  searchedAt: string;
  resultCount: number;
  summarySource: "provider" | "generated" | "fallback" | "none";
  providerRequestId?: string;
  usage?: WebSearchUsage;
}
```

Replace `WebSearchResponse` with:

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

Replace `WebSearchProviderResult` with:

```ts
export interface WebSearchProviderResult {
  results: WebSearchResult[];
  answer?: string;
  requestId?: string;
  usage?: WebSearchUsage;
}
```

- [ ] **Step 4: Run the test to verify it still fails for missing implementation**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because `runWebSearch()` still returns the old response shape.

- [ ] **Step 5: Commit the type and failing-test checkpoint**

```bash
git add src/lib/server/agent/search/types.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "test: define web search evidence response contract"
```

---

### Task 2: Generate Citations and Metadata in `runWebSearch`

**Files:**
- Modify: `src/lib/server/agent/search/webSearchTool.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Add response finalization helpers**

In `src/lib/server/agent/search/webSearchTool.ts`, update the type import to include `WebSearchMetadata`, `WebSearchProviderResult`, `WebSearchResult`, and `WebSearchCitation`:

```ts
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
```

Add these helpers below `summarize()`:

```ts
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

function metadataFor(providerResult: WebSearchProviderResult | undefined, results: WebSearchResult[], summarySource: WebSearchMetadata["summarySource"]): WebSearchMetadata {
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
```

- [ ] **Step 2: Use `buildSearchResponse()` in success paths**

In both success branches inside `runWebSearch()`, replace the returned object:

```ts
return {
  engine,
  route,
  query: input.query,
  results,
  summary: answer || summarize(results),
  diagnostics: { attempts, fallbackOrder: engines }
};
```

with:

```ts
const summarySource = answer ? "provider" : "fallback";
return buildSearchResponse({
  engine,
  route,
  query: input.query,
  providerResult,
  summary: answer || summarize(results),
  summarySource,
  attempts,
  fallbackOrder: engines
});
```

Apply this replacement in the first attempt success branch and the retry success branch.

- [ ] **Step 3: Use `buildSearchResponse()` in the all-failed path**

Replace the final return in `runWebSearch()`:

```ts
return {
  engine: null,
  route,
  query: input.query,
  results: [],
  summary: "No configured search engine returned results.",
  diagnostics: { attempts, fallbackOrder: engines }
};
```

with:

```ts
return buildSearchResponse({
  engine: null,
  route,
  query: input.query,
  providerResult: { results: [] },
  summary: "No configured search engine returned results.",
  summarySource: "none",
  attempts,
  fallbackOrder: engines
});
```

- [ ] **Step 4: Run the focused web search tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the router tests to verify no route regression**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit citation and metadata response generation**

```bash
git add src/lib/server/agent/search/webSearchTool.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "feat: return web search citations and metadata"
```

---

### Task 3: Preserve Enriched Result Fields Through Provider Normalization

**Files:**
- Modify: `src/lib/server/agent/search/providers.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Add failing test for Brave site fields**

Append this test to `src/lib/server/agent/search/webSearchTool.test.ts`:

```ts
test("runWebSearch preserves Brave site metadata in results and citations", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    web: {
      results: [{
        title: "Example Docs",
        url: "https://docs.example.com/page",
        description: "Example docs snippet",
        profile: {
          name: "Example Docs",
          img: "https://docs.example.com/favicon.ico"
        },
        page_age: "2026-05-30"
      }]
    }
  }), { status: 200 })) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "example docs" }, settings);
    assert.equal(result.results[0].siteName, "Example Docs");
    assert.equal(result.results[0].favicon, "https://docs.example.com/favicon.ico");
    assert.equal(result.results[0].publishedAt, "2026-05-30");
    assert.equal(result.citations[0].siteName, "Example Docs");
    assert.equal(result.citations[0].publishedAt, "2026-05-30");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because `limitResults()` drops `siteName`, `favicon`, and `displayUrl`, and Brave does not map `profile` yet.

- [ ] **Step 3: Preserve optional result fields in `limitResults()`**

In `src/lib/server/agent/search/providers.ts`, replace the `out.push({ ... })` block inside `limitResults()` with:

```ts
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
```

- [ ] **Step 4: Map Brave profile fields**

In `braveSearch()`, replace the result mapping object with:

```ts
  return { results: limitResults(rows.map((row: any) => ({
    title: row.title,
    url: row.url,
    snippet: row.description,
    source: "brave",
    publishedAt: row.page_age || row.age,
    siteName: row.profile?.name,
    favicon: row.profile?.img
  })), input.maxResults) };
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit enriched result preservation**

```bash
git add src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "feat: preserve web search provider result metadata"
```

---

### Task 4: Return Provider Request IDs and Usage

**Files:**
- Modify: `src/lib/server/agent/search/providers.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Extend the Tavily test to assert provider metadata**

In `src/lib/server/agent/search/webSearchTool.test.ts`, inside `runWebSearch returns redacted Tavily request diagnostics`, replace the mocked response with:

```ts
  globalThis.fetch = (async () => new Response(JSON.stringify({
    answer: "Figma is a collaborative interface design tool.",
    results: [{
      title: "Figma",
      url: "https://www.figma.com/",
      content: "Figma is a collaborative interface design tool.",
      published_date: "2026-01-02",
      favicon: "https://www.figma.com/favicon.ico"
    }],
    usage: {
      credits: 1
    },
    request_id: "tavily-request-1"
  }), { status: 200 })) as typeof fetch;
```

Then add these assertions after `assert.equal(result.summary, "Figma is a collaborative interface design tool.");`:

```ts
    assert.equal(result.metadata.summarySource, "provider");
    assert.equal(result.metadata.providerRequestId, "tavily-request-1");
    assert.deepEqual(result.metadata.usage, { credits: 1 });
    assert.equal(result.results[0].publishedAt, "2026-01-02");
    assert.equal(result.results[0].favicon, "https://www.figma.com/favicon.ico");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because Tavily provider result does not yet return `requestId`, `usage`, or `favicon`.

- [ ] **Step 3: Return request id, usage, and favicon from Tavily**

In `tavilySearch()`, replace the return object with:

```ts
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
```

- [ ] **Step 4: Return request ids and usage from Baidu chat completions**

In `baiduSearch()`, replace the final return with:

```ts
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
```

- [ ] **Step 5: Return request ids from Baidu Web**

In `baiduWebSearch()`, replace the return object with:

```ts
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
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit provider metadata mapping**

```bash
git add src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "feat: map web search provider request metadata"
```

---

### Task 5: Preserve Baidu Fast Provider Answer with References

**Files:**
- Modify: `src/lib/server/agent/search/providers.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Add failing Baidu Fast regression test**

Append this test to `src/lib/server/agent/search/webSearchTool.test.ts`:

```ts
test("runWebSearch preserves Baidu Fast answer when references are present", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    request_id: "baidu-fast-request-1",
    choices: [{
      message: {
        role: "assistant",
        content: "北戴河景区位于河北省秦皇岛市，是滨海旅游与避暑胜地。"
      }
    }],
    references: [{
      id: 2,
      title: "北戴河景区",
      url: "https://baike.baidu.com/item/%E5%8C%97%E6%88%B4%E6%B2%B3%E6%99%AF%E5%8C%BA/10433529",
      content: "北戴河景区位于河北省秦皇岛市西南部。",
      type: "web",
      website: "百度百科",
      icon: "https://example.com/baidu.ico",
      date: "2025-10-23 11:06:41"
    }]
  }), { status: 200 })) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "北戴河景区" }, {
      ...settings,
      defaultEngine: "baidu_fast",
      engines: {
        ...settings.engines,
        baidu_fast: { enabled: true, apiKey: "baidu-key" }
      }
    });
    assert.equal(result.engine, "baidu_fast");
    assert.equal(result.summary, "北戴河景区位于河北省秦皇岛市，是滨海旅游与避暑胜地。");
    assert.equal(result.metadata.summarySource, "provider");
    assert.equal(result.metadata.providerRequestId, "baidu-fast-request-1");
    assert.equal(result.citations[0].providerRefId, 2);
    assert.equal(result.citations[0].siteName, "百度百科");
    assert.equal(result.results[0].favicon, "https://example.com/baidu.ico");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because `baiduFastSearch()` drops `answer` and `requestId` when references exist.

- [ ] **Step 3: Update `baiduFastSearch()` to return answer, request id, and source fields**

In `baiduFastSearch()`, add this line after `rows` is computed:

```ts
  const content = data.choices?.[0]?.message?.content;
```

Replace the `if (Array.isArray(rows) && rows.length > 0)` return with:

```ts
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
```

Replace the fallback return with:

```ts
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
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Baidu Fast answer preservation**

```bash
git add src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "fix: preserve baidu fast search answers with sources"
```

---

### Task 6: Enrich Bocha Request and Result Mapping

**Files:**
- Modify: `src/lib/server/agent/search/providers.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] **Step 1: Add failing Bocha mapping test**

Append this test to `src/lib/server/agent/search/webSearchTool.test.ts`:

```ts
test("runWebSearch maps Bocha source metadata and requests summaries", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String((init as RequestInit).body));
    return new Response(JSON.stringify({
      log_id: "bocha-log-1",
      data: {
        webPages: {
          value: [{
            id: "bocha-1",
            name: "天空为什么是蓝色的？科学原理解析",
            url: "https://example.com/why-is-sky-blue",
            displayUrl: "https://example.com/why-is-sky-blue",
            snippet: "天空呈现蓝色是由于太阳光进入大气层后发生散射。",
            summary: "本文详细解释了瑞利散射原理。",
            siteName: "科普中国",
            siteIcon: "https://example.com/favicon.ico",
            datePublished: "2024-03-15T10:30:00Z"
          }]
        }
      }
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "天空为什么是蓝色的？" }, {
      ...settings,
      defaultEngine: "bocha",
      engines: {
        ...settings.engines,
        bocha: { enabled: true, apiKey: "bocha-key" }
      }
    });
    assert.equal(requestBody.summary, true);
    assert.equal(requestBody.freshness, "noLimit");
    assert.equal(result.metadata.providerRequestId, "bocha-log-1");
    assert.equal(result.results[0].displayUrl, "https://example.com/why-is-sky-blue");
    assert.equal(result.results[0].siteName, "科普中国");
    assert.equal(result.results[0].favicon, "https://example.com/favicon.ico");
    assert.equal(result.results[0].providerRefId, "bocha-1");
    assert.equal(result.citations[0].siteName, "科普中国");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: FAIL because Bocha request body does not include `summary`/`freshness`, and result metadata is not mapped.

- [ ] **Step 3: Update Bocha request body**

In `bochaSearch()`, replace the `body: JSON.stringify({ ... })` object with:

```ts
    body: JSON.stringify({
      query: withDomains(input.query, input),
      freshness: "noLimit",
      summary: true,
      count: Math.max(1, Math.min(20, input.maxResults ?? 5))
    }),
```

- [ ] **Step 4: Map Bocha source fields and request id**

Replace the return object in `bochaSearch()` with:

```ts
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
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/search/webSearchTool.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Bocha provider enrichment**

```bash
git add src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "feat: enrich bocha web search results"
```

---

### Task 7: Full Search Runtime Verification

**Files:**
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`
- Test: `src/lib/server/agent/search/router.test.ts`
- Test: `src/lib/server/agent/tools/toolClassification.test.ts`
- Test: `src/routes/api/settings/web-search/test/+server.ts`

- [ ] **Step 1: Run all search-specific tests**

Run:

```bash
node --import tsx --test \
  src/lib/server/agent/search/webSearchTool.test.ts \
  src/lib/server/agent/search/router.test.ts \
  src/lib/server/agent/tools/toolClassification.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run a TypeScript import smoke check for the settings test endpoint**

Run:

```bash
./node_modules/.bin/tsx --eval "import('./src/routes/api/settings/web-search/test/+server.ts').then(() => console.log('web-search settings endpoint ok'))"
```

Expected output contains:

```txt
web-search settings endpoint ok
```

- [ ] **Step 3: Run a production build**

Run:

```bash
npm run build
```

Expected: PASS. If this fails due to an unrelated pre-existing build issue, capture the first error block and continue only after confirming search-specific tests still pass.

- [ ] **Step 4: Commit verification-only adjustments if any were required**

If no files changed during verification, skip this commit. If a search-specific test or type fix was required, commit it:

```bash
git add src/lib/server/agent/search/types.ts src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.ts src/lib/server/agent/search/webSearchTool.test.ts
git commit -m "test: verify web search evidence package"
```

---

### Task 8: Documentation Updates

**Files:**
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `readme.md`

- [ ] **Step 1: Update `features.md`**

Under `## 2026-06-01`, inside `### 内置网页搜索工具 (Built-In Web Search Tool)`, append these bullets:

```md
- **来源证据包**: `webSearch` 结果现在包含 `citations`、`metadata` 与每条 result 的 `citationId`，Agent 可以稳定把最终回答引用到真实 URL，而不是只依赖临时拼接的结果列表。
- **Provider 元数据归一化**: Brave、Tavily、Baidu Fast/Baidu Web、Bocha 等 provider 会尽量保留 request id、站点名、favicon、发布时间、provider 原始引用 id 和 usage/credits，排障信息继续保持密钥脱敏。
- **百度 Fast answer 保留**: 当百度 `web_summary` 同时返回综合 answer 与 references 时，工具会保留 provider answer 作为摘要，并将 references 标准化为可引用来源。
```

- [ ] **Step 2: Update `prd.md`**

In section `## 2.1 Scope Clarification (2026-02-27)`, after the existing `[Done]` web search settings bullets, add:

```md
- [Done] 内置 `webSearch` 的工具结果必须提供 source-level citations 和 metadata；每条标准化 result 都应能映射到稳定 citation id，provider request id / usage / 站点名 / favicon / 发布时间等字段应在可用时保留，最终回答引用不应只依赖临时 URL 拼接。
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `## 2026-06-01`, inside `### Built-In Web Search Tool`, append:

```md
- Upgraded normalized search responses with source-level citations, per-result citation ids, provider metadata, and summary source tracking while preserving the existing `summary` text contract.
- Preserved richer provider fields such as request ids, usage credits, site names, favicons, publication dates, and Baidu/Bocha provider reference ids when available.
- Fixed Baidu Fast search normalization so provider answers are retained even when source references are also returned.
```

- [ ] **Step 4: Update `readme.md`**

In `## Key Highlights`, replace the existing `**Built-In Web Search**` bullet with:

```md
- **Built-In Web Search**: `webSearch` is now a shared Agent-layer tool with route-based fallback across DuckDuckGo, Brave, Tavily, Exa, Serper, Baidu Qianfan, Baidu Fast, Baidu Web, Ark, Grok, and Bocha. Routing is intent-based (`china`, `global`, `official_docs`, `research`) instead of fragile Chinese/news keyword buckets, and automatic engine selection can use priority, random, or in-process round-robin among configured engines. `/settings/search` manages engine credentials, routing, timeouts, max results, live test queries, effective default base URLs, and redacted request diagnostics for each test attempt. Search results include source-level citations, citation-linked results, and provider metadata so final answers can cite real URLs consistently.
```

- [ ] **Step 5: Review docs for machine-specific absolute paths**

Run:

```bash
rg -n "/Users/|file://" features.md prd.md CHANGELOG.md readme.md
```

Expected: no new matches introduced by this task. Existing matches outside this task should not be edited unless they are in the lines just changed.

- [ ] **Step 6: Commit documentation updates**

```bash
git add features.md prd.md CHANGELOG.md readme.md
git commit -m "docs: record web search evidence package"
```

---

### Task 9: Final Verification

**Files:**
- Verify: `src/lib/server/agent/search/types.ts`
- Verify: `src/lib/server/agent/search/webSearchTool.ts`
- Verify: `src/lib/server/agent/search/providers.ts`
- Verify: `src/lib/server/agent/search/webSearchTool.test.ts`
- Verify: `features.md`
- Verify: `prd.md`
- Verify: `CHANGELOG.md`
- Verify: `readme.md`

- [ ] **Step 1: Run focused tests**

```bash
node --import tsx --test \
  src/lib/server/agent/search/webSearchTool.test.ts \
  src/lib/server/agent/search/router.test.ts \
  src/lib/server/agent/tools/toolClassification.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Review final diff**

```bash
git diff --stat
git diff -- src/lib/server/agent/search/types.ts src/lib/server/agent/search/webSearchTool.ts src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts
```

Expected:

- Search changes are limited to Agent-layer search files and tests.
- No Channel-layer files are modified.
- `summary` remains a string in `WebSearchResponse`.
- Tool input fields remain `query`, `maxResults`, `engine`, `route`, `includeDomains`, and `excludeDomains`.
- Provider diagnostics still redact API keys.

- [ ] **Step 4: Commit final cleanup if needed**

If Step 3 surfaces small search-specific cleanup changes, make them and commit:

```bash
git add src/lib/server/agent/search/types.ts src/lib/server/agent/search/webSearchTool.ts src/lib/server/agent/search/providers.ts src/lib/server/agent/search/webSearchTool.test.ts features.md prd.md CHANGELOG.md readme.md
git commit -m "chore: finalize web search evidence package"
```

Skip this commit if no files changed after Task 8.

---

## Self-Review

Spec coverage:

- TD Stage 1 output contract is covered by Tasks 1 and 2.
- TD Stage 2 provider field mapping is covered by Tasks 3 through 6.
- Redacted diagnostics are preserved and tested in Tasks 4 and 7.
- Documentation duties from `AGENTS.md` are covered by Task 8.
- Full verification is covered by Tasks 7 and 9.

Placeholder scan:

- The plan contains no unresolved placeholder markers and no unspecified "add tests" steps.
- Each code-changing task includes concrete snippets and exact commands.

Type consistency:

- Response fields use `citations`, `metadata`, `citationId`, `providerRequestId`, `summarySource`.
- Input fields remain existing camelCase names.
- Provider result fields use `requestId` and `usage`, matching `WebSearchProviderResult`.

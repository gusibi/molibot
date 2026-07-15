import assert from "node:assert/strict";
import test from "node:test";
import { runWebSearch } from "$lib/server/agent/search/webSearchTool.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const settings: WebSearchSettings = {
  enabled: true,
  defaultRoute: "global",
  defaultEngine: "brave",
  engineSelectionStrategy: "priority",
  maxResults: 2,
  timeoutMs: 1000,
  retryTimeoutMs: 2000,
  engines: {
    duckduckgo: { enabled: true, apiKey: "" },
    anysearch: { enabled: true, apiKey: "" },
    brave: { enabled: true, apiKey: "brave-key" },
    tavily: { enabled: false, apiKey: "" },
    exa: { enabled: false, apiKey: "" },
    serper: { enabled: false, apiKey: "" },
    baidu: { enabled: false, apiKey: "" },
    baidu_fast: { enabled: false, apiKey: "" },
    baidu_web: { enabled: false, apiKey: "" },
    ark: { enabled: false, apiKey: "" },
    grok: { enabled: false, apiKey: "" },
    bocha: { enabled: false, apiKey: "" }
  }
};

test("runWebSearch follows the AnySearch REST protocol with optional authentication", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      code: 0,
      message: "success",
      data: {
        results: [{ title: "Go 1.22", url: "https://go.dev/doc/go1.22", snippet: "Release notes" }],
        metadata: { request_id: "req-anysearch-1" }
      }
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const anonymous = await runWebSearch({ query: "Go 1.22 release notes", engine: "anysearch" }, settings);
    assert.equal(calls[0].url, "https://api.anysearch.com/v1/search");
    assert.equal(new Headers(calls[0].init?.headers).has("Authorization"), false);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { query: "Go 1.22 release notes", max_results: 2 });
    assert.equal(anonymous.metadata.providerRequestId, "req-anysearch-1");
    assert.equal(anonymous.results[0].source, "anysearch");

    await runWebSearch({ query: "authenticated", engine: "anysearch" }, {
      ...settings,
      engines: { ...settings.engines, anysearch: { enabled: true, apiKey: "secret-key" } }
    });
    assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer secret-key");
    assert.equal(anonymous.diagnostics.attempts[0].request?.headers?.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebSearch returns normalized provider results", async () => {
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
    assert.equal(result.engine, "brave");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].url, "https://example.com");
    assert.equal(result.diagnostics.attempts[0].ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebSearch returns redacted Tavily request diagnostics", async () => {
  const originalFetch = globalThis.fetch;
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
  try {
    const result = await runWebSearch({ query: "介绍一下 Figma" }, {
      ...settings,
      defaultEngine: "tavily",
      engines: {
        ...settings.engines,
        tavily: { enabled: true, apiKey: "tavily-key" }
      }
    }, undefined, "Asia/Shanghai");
    const request = result.diagnostics.attempts[0].request;
    assert.equal(result.engine, "tavily");
    assert.equal(result.summary, "Figma is a collaborative interface design tool.");
    assert.equal(result.metadata.summarySource, "provider");
    assert.equal(result.metadata.providerRequestId, "tavily-request-1");
    assert.deepEqual(result.metadata.usage, { credits: 1 });
    assert.equal(result.results[0].publishedAt, "2026-01-02");
    assert.equal(result.results[0].favicon, "https://www.figma.com/favicon.ico");
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "https://api.tavily.com/search");
    assert.deepEqual(request?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer <redacted>"
    });
    assert.equal((request?.body as any)?.max_results, 2);
    assert.equal((request?.body as any)?.include_answer, true);
    assert.equal((request?.body as any)?.query, "介绍一下 Figma");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebSearch sends concise provider query while preserving original response query", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      web: {
        results: [{
          title: "Weather",
          url: "https://example.com/weather",
          description: "Tomorrow weather"
        }]
      }
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "明天天气" }, settings, undefined, "Asia/Shanghai");
    const q = new URL(requestedUrl).searchParams.get("q") ?? "";
    assert.equal(result.query, "明天天气");
    assert.equal(q, "明天天气");
    assert.equal(result.diagnostics.attempts[0].request?.url, requestedUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebSearch tolerates quoted literal route and engine arguments from weak tool callers", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      web: {
        results: [{
          title: "Weather",
          url: "https://example.com/weather",
          description: "Tomorrow weather"
        }]
      }
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await runWebSearch({
      query: "深圳天气",
      route: "\n\"global\"\n",
      engine: "\n\"brave\"\n"
    }, settings);
    assert.equal(result.route, "global");
    assert.equal(result.engine, "brave");
    assert.equal(new URL(requestedUrl).searchParams.get("q"), "深圳天气");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("runWebSearch returns 'No search results found.' if query succeeded but yielded no results", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
  try {
    const result = await runWebSearch({ query: "nonexistent", engine: "duckduckgo" }, settings);
    assert.equal(result.summary, "No search results found.");
    assert.equal(result.results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebSearch returns 'No configured search engine returned results.' if all engines were skipped/disabled", async () => {
  const disabledSettings: WebSearchSettings = {
    ...settings,
    engines: {
      ...settings.engines,
      duckduckgo: { enabled: false, apiKey: "" },
      brave: { enabled: false, apiKey: "" }
    }
  };
  const result = await runWebSearch({ query: "hello", engine: "duckduckgo" }, disabledSettings);
  assert.equal(result.summary, "No configured search engine returned results.");
  assert.equal(result.results.length, 0);
});

test("runWebSearch rejects empty queries", async () => {
  await assert.rejects(() => runWebSearch({ query: " " }, settings), /Search query is required/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { inferWebSearchRoute, resolveWebSearchEngines } from "$lib/server/agent/search/router.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const settings: WebSearchSettings = {
  enabled: true,
  defaultRoute: "auto",
  defaultEngine: "auto",
  maxResults: 5,
  timeoutMs: 60000,
  retryTimeoutMs: 120000,
  engines: {
    duckduckgo: { enabled: true, apiKey: "" },
    brave: { enabled: true, apiKey: "brave-key" },
    tavily: { enabled: true, apiKey: "tavily-key" },
    exa: { enabled: true, apiKey: "exa-key" },
    serper: { enabled: true, apiKey: "serper-key" },
    baidu: { enabled: true, apiKey: "baidu-key" },
    bocha: { enabled: true, apiKey: "bocha-key" }
  }
};

test("inferWebSearchRoute chooses domestic news for Chinese current-news queries", () => {
  assert.equal(inferWebSearchRoute("今天国内 AI 新闻", "auto", settings), "domestic_news");
});

test("inferWebSearchRoute chooses international news for overseas news queries", () => {
  assert.equal(inferWebSearchRoute("latest international AI news", "auto", settings), "international_news");
});

test("resolveWebSearchEngines follows Chinese route fallback order", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "中文搜索", route: "chinese_general" }, settings, "chinese_general"), [
    "baidu",
    "bocha",
    "duckduckgo"
  ]);
});

test("resolveWebSearchEngines honors explicit engine", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "x", engine: "exa" }, settings, "global_general"), ["exa"]);
});

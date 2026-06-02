import assert from "node:assert/strict";
import test from "node:test";
import {
  inferWebSearchRoute,
  resetWebSearchEngineSelectionStateForTest,
  resolveWebSearchEngines
} from "$lib/server/agent/search/router.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const settings: WebSearchSettings = {
  enabled: true,
  defaultRoute: "auto",
  defaultEngine: "auto",
  engineSelectionStrategy: "priority",
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
    baidu_fast: { enabled: true, apiKey: "baidu-key" },
    baidu_web: { enabled: true, apiKey: "baidu-key" },
    ark: { enabled: true, apiKey: "ark-key" },
    grok: { enabled: true, apiKey: "grok-key" },
    bocha: { enabled: true, apiKey: "bocha-key" }
  }
};

test("inferWebSearchRoute routes China-local queries to China sources", () => {
  assert.equal(inferWebSearchRoute({ query: "今天国内 AI 新闻", route: "auto" }, settings), "china");
});

test("inferWebSearchRoute routes common China city local queries to China sources", () => {
  assert.equal(inferWebSearchRoute({ query: "深圳天气", route: "auto" }, settings), "china");
});

test("inferWebSearchRoute routes explicit international queries to global sources", () => {
  assert.equal(inferWebSearchRoute({ query: "latest international AI news", route: "auto" }, settings), "global");
});

test("inferWebSearchRoute does not treat Chinese technical documentation queries as China-local news", () => {
  assert.equal(inferWebSearchRoute({ query: "OpenAI 最新 API 文档", route: "auto" }, settings), "official_docs");
});

test("inferWebSearchRoute routes domain-scoped searches to official docs", () => {
  assert.equal(inferWebSearchRoute({ query: "pricing", includeDomains: ["openai.com"] }, settings), "official_docs");
});

test("resolveWebSearchEngines follows China route fallback order", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "中文搜索", route: "china" }, settings, "china"), [
    "baidu_web",
    "baidu_fast",
    "baidu",
    "bocha",
    "ark",
    "duckduckgo"
  ]);
});

test("resolveWebSearchEngines follows global fallback order", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "latest international AI news", route: "global" }, settings, "global"), [
    "tavily",
    "brave",
    "serper",
    "exa",
    "grok",
    "duckduckgo"
  ]);
});

test("resolveWebSearchEngines honors explicit engine", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "x", engine: "exa" }, settings, "global"), ["exa"]);
});

test("resolveWebSearchEngines skips enabled paid engines without API keys in auto mode", () => {
  assert.deepEqual(resolveWebSearchEngines({ query: "x" }, {
    ...settings,
    engines: {
      ...settings.engines,
      brave: { enabled: true, apiKey: "" },
      serper: { enabled: true, apiKey: "" }
    }
  }, "global"), ["tavily", "exa", "grok", "duckduckgo"]);
});

test("resolveWebSearchEngines rotates configured engines with round-robin strategy", () => {
  resetWebSearchEngineSelectionStateForTest();
  const roundRobinSettings: WebSearchSettings = {
    ...settings,
    engineSelectionStrategy: "round_robin"
  };
  assert.deepEqual(resolveWebSearchEngines({ query: "x" }, roundRobinSettings, "global").slice(0, 3), ["tavily", "brave", "serper"]);
  assert.deepEqual(resolveWebSearchEngines({ query: "x" }, roundRobinSettings, "global").slice(0, 3), ["brave", "serper", "exa"]);
  assert.deepEqual(resolveWebSearchEngines({ query: "x" }, roundRobinSettings, "global").slice(0, 3), ["serper", "exa", "grok"]);
});

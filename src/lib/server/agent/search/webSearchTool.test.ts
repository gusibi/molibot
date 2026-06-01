import assert from "node:assert/strict";
import test from "node:test";
import { runWebSearch } from "$lib/server/agent/search/webSearchTool.js";
import type { WebSearchSettings } from "$lib/server/settings/index.js";

const settings: WebSearchSettings = {
  enabled: true,
  defaultRoute: "global_general",
  defaultEngine: "brave",
  maxResults: 2,
  timeoutMs: 1000,
  retryTimeoutMs: 2000,
  engines: {
    duckduckgo: { enabled: true, apiKey: "" },
    brave: { enabled: true, apiKey: "brave-key" },
    tavily: { enabled: false, apiKey: "" },
    exa: { enabled: false, apiKey: "" },
    serper: { enabled: false, apiKey: "" },
    baidu: { enabled: false, apiKey: "" },
    bocha: { enabled: false, apiKey: "" }
  }
};

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

test("runWebSearch rejects empty queries", async () => {
  await assert.rejects(() => runWebSearch({ query: " " }, settings), /Search query is required/);
});

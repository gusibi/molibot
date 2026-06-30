import assert from "node:assert/strict";
import test from "node:test";
import type { WebSearchSettings } from "$lib/server/settings/schema";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import {
  buildDesktopWebSearchEngine,
  buildDesktopWebSearchSummary,
  updateDesktopWebSearchSettings
} from "./desktopWebSearch";

test("buildDesktopWebSearchEngine replaces apiKey with hasApiKey and keeps baseUrl", () => {
  const engine = buildDesktopWebSearchEngine("tavily", {
    enabled: true,
    apiKey: "tvly-SECRET-KEY",
    baseUrl: "https://api.tavily.com"
  });

  assert.equal(engine.id, "tavily");
  assert.equal(engine.enabled, true);
  assert.equal(engine.hasApiKey, true);
  assert.equal(engine.baseUrl, "https://api.tavily.com");

  const serialized = JSON.stringify(engine);
  assert.equal(serialized.includes("tvly-SECRET-KEY"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopWebSearchEngine reports an unconfigured engine via hasApiKey=false", () => {
  const engine = buildDesktopWebSearchEngine("brave", { enabled: false, apiKey: "   " });
  assert.equal(engine.enabled, false);
  assert.equal(engine.hasApiKey, false);
  assert.equal(engine.baseUrl, "");
});

test("buildDesktopWebSearchSummary keeps routing config and counts without leaking keys", () => {
  const summary = buildDesktopWebSearchSummary({
    enabled: true,
    defaultRoute: "global",
    defaultEngine: "auto",
    engineSelectionStrategy: "priority",
    maxResults: 8,
    timeoutMs: 5000,
    retryTimeoutMs: 2000,
    engines: {
      duckduckgo: { enabled: true, apiKey: "" },
      tavily: { enabled: true, apiKey: "tvly-SECRET-KEY", baseUrl: "https://api.tavily.com" },
      brave: { enabled: false, apiKey: "brv-SECRET-KEY" }
    }
  } as unknown as WebSearchSettings);

  assert.equal(summary.enabled, true);
  assert.equal(summary.defaultRoute, "global");
  assert.equal(summary.engineSelectionStrategy, "priority");
  assert.equal(summary.maxResults, 8);
  assert.equal(summary.counts.totalEngines, 3);
  assert.equal(summary.counts.enabledEngines, 2);
  assert.equal(summary.counts.configuredEngines, 2);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("tvly-SECRET-KEY"), false);
  assert.equal(serialized.includes("brv-SECRET-KEY"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopWebSearchSummary tolerates a missing engines map", () => {
  const summary = buildDesktopWebSearchSummary({
    enabled: false,
    defaultRoute: "auto",
    defaultEngine: "auto",
    engineSelectionStrategy: "priority",
    maxResults: 5,
    timeoutMs: 5000,
    retryTimeoutMs: 2000
  } as unknown as WebSearchSettings);

  assert.deepEqual(summary.engines, []);
  assert.deepEqual(summary.counts, { totalEngines: 0, enabledEngines: 0, configuredEngines: 0 });
});

test("updateDesktopWebSearchSettings preserves, replaces, and clears API keys per engine", () => {
  const current = {
    ...structuredClone(defaultRuntimeSettings.webSearch),
    enabled: true,
    defaultRoute: "global",
    defaultEngine: "tavily",
    engineSelectionStrategy: "priority",
    maxResults: 5,
    timeoutMs: 5000,
    retryTimeoutMs: 2000,
    engines: {
      ...structuredClone(defaultRuntimeSettings.webSearch.engines),
      tavily: { enabled: true, apiKey: "keep-me", baseUrl: "https://old.example" },
      brave: { enabled: true, apiKey: "clear-me", baseUrl: "" },
      serper: { enabled: false, apiKey: "replace-me", baseUrl: "" }
    }
  } as unknown as WebSearchSettings;

  const updated = updateDesktopWebSearchSettings(current, {
    enabled: true,
    defaultRoute: "auto",
    defaultEngine: "auto",
    engineSelectionStrategy: "priority",
    maxResults: 8,
    timeoutMs: 6000,
    retryTimeoutMs: 2500,
    engines: [
      { id: "tavily", enabled: true, baseUrl: "https://new.example" },
      { id: "brave", enabled: false, baseUrl: "", clearApiKey: true },
      { id: "serper", enabled: true, baseUrl: "", apiKey: "new-key" }
    ]
  });

  assert.equal(updated.engines.tavily.apiKey, "keep-me");
  assert.equal(updated.engines.tavily.baseUrl, "https://new.example");
  assert.equal(updated.engines.brave.apiKey, "");
  assert.equal(updated.engines.serper.apiKey, "new-key");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesktopMediaEngine,
  buildDesktopMediaGenerateInput,
  buildDesktopMediaGenerateSummary,
  type MediaGenerateSettings
} from "./desktopMediaGenerate";

test("buildDesktopMediaEngine replaces apiKey with hasApiKey and keeps baseUrl + model", () => {
  const engine = buildDesktopMediaEngine("openai", {
    enabled: true,
    apiKey: "sk-IMAGE-SECRET",
    baseUrl: "https://api.openai.com",
    model: "gpt-image-1"
  });

  assert.equal(engine.id, "openai");
  assert.equal(engine.enabled, true);
  assert.equal(engine.hasApiKey, true);
  assert.equal(engine.baseUrl, "https://api.openai.com");
  assert.equal(engine.model, "gpt-image-1");

  const serialized = JSON.stringify(engine);
  assert.equal(serialized.includes("sk-IMAGE-SECRET"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopMediaEngine reports an unconfigured engine via hasApiKey=false", () => {
  const engine = buildDesktopMediaEngine("agnes", { enabled: false, apiKey: "" });
  assert.equal(engine.enabled, false);
  assert.equal(engine.hasApiKey, false);
  assert.equal(engine.baseUrl, "");
  assert.equal(engine.model, "");
});

test("buildDesktopMediaGenerateSummary keeps config + counts without leaking keys", () => {
  const summary = buildDesktopMediaGenerateSummary({
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: true, apiKey: "" },
      openai: { enabled: true, apiKey: "sk-IMAGE-SECRET", model: "gpt-image-1" },
      google: { enabled: false, apiKey: "ggl-SECRET" }
    }
  } as unknown as MediaGenerateSettings);

  assert.equal(summary.enabled, true);
  assert.equal(summary.defaultEngine, "auto");
  assert.equal(summary.counts.totalEngines, 3);
  assert.equal(summary.counts.enabledEngines, 2);
  assert.equal(summary.counts.configuredEngines, 2);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("sk-IMAGE-SECRET"), false);
  assert.equal(serialized.includes("ggl-SECRET"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopMediaGenerateSummary tolerates a missing engines map", () => {
  const summary = buildDesktopMediaGenerateSummary({
    enabled: false,
    defaultEngine: "auto"
  } as unknown as MediaGenerateSettings);

  assert.deepEqual(summary.engines, []);
  assert.deepEqual(summary.counts, { totalEngines: 0, enabledEngines: 0, configuredEngines: 0 });
});

test("buildDesktopMediaGenerateInput preserves, replaces, and clears API keys", () => {
  const updated = buildDesktopMediaGenerateInput({
    enabled: true,
    defaultEngine: "auto",
    engines: {
      openai: { enabled: true, apiKey: "keep-me", baseUrl: "https://old.example", model: "old-model" },
      google: { enabled: true, apiKey: "clear-me" },
      agnes: { enabled: false, apiKey: "replace-me" }
    }
  }, {
    enabled: false,
    defaultEngine: "openai",
    engines: [
      { id: "openai", enabled: true, baseUrl: "https://new.example", model: "new-model" },
      { id: "google", enabled: false, baseUrl: "", model: "", clearApiKey: true },
      { id: "agnes", enabled: true, baseUrl: "", model: "agnes-2", apiKey: "new-key" }
    ]
  });

  assert.equal(updated.enabled, false);
  assert.equal(updated.engines?.openai.apiKey, "keep-me");
  assert.equal(updated.engines?.openai.model, "new-model");
  assert.equal(updated.engines?.google.apiKey, "");
  assert.equal(updated.engines?.agnes.apiKey, "new-key");
});

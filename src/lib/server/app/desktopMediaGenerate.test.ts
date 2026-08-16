import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesktopMediaEngine,
  buildDesktopMediaGenerateInput,
  buildDesktopMediaGenerateSummary,
  isDesktopMediaGenerateUpdateRequest,
  type MediaEngineSettings,
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

test("buildDesktopMediaEngine surfaces custom engine name and protocol", () => {
  const engine = buildDesktopMediaEngine("my-custom", {
    enabled: true,
    apiKey: "custom-secret",
    baseUrl: "https://custom.example.com",
    model: "custom-model",
    name: "My Custom",
    protocol: "chat-completions"
  } as MediaEngineSettings);

  assert.equal(engine.name, "My Custom");
  assert.equal(engine.protocol, "chat-completions");
  const serialized = JSON.stringify(engine);
  assert.equal(serialized.includes("custom-secret"), false);
});

test("buildDesktopMediaGenerateInput adds and removes custom engines when builtin set is provided", () => {
  const updated = buildDesktopMediaGenerateInput({
    enabled: true,
    defaultEngine: "auto",
    engines: {
      openai: { enabled: true, apiKey: "keep-me" },
      "old-custom": { enabled: true, apiKey: "old-key", name: "Old", protocol: "images-generations" }
    }
  }, {
    enabled: false,
    defaultEngine: "openai",
    engines: [
      { id: "openai", enabled: true, baseUrl: "", model: "" },
      { id: "new-custom", enabled: true, baseUrl: "https://new.example", model: "new-model", name: "New", protocol: "chat-completions" }
    ]
  }, new Set(["openai"]));

  assert.equal(updated.enabled, false);
  assert.equal(updated.engines?.openai.apiKey, "keep-me");
  assert.equal(updated.engines?.["old-custom"], undefined);
  assert.equal(updated.engines?.["new-custom"].apiKey, "");
  assert.equal(updated.engines?.["new-custom"].name, "New");
  assert.equal(updated.engines?.["new-custom"].protocol, "chat-completions");
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

test("buildDesktopMediaGenerateInput keeps an existing custom protocol immutable", () => {
  const updated = buildDesktopMediaGenerateInput({
    enabled: true,
    defaultEngine: "auto",
    engines: {
      "custom-chat": {
        enabled: true,
        apiKey: "custom-key",
        baseUrl: "https://custom.example",
        model: "custom-model",
        name: "Custom Chat",
        protocol: "chat-completions"
      }
    }
  }, {
    enabled: true,
    defaultEngine: "custom-chat",
    engines: [{
      id: "custom-chat",
      enabled: true,
      baseUrl: "https://custom.example",
      model: "custom-model",
      protocol: "images-generations"
    }]
  });

  assert.equal(updated.engines?.["custom-chat"].protocol, "chat-completions");
});

test("isDesktopMediaGenerateUpdateRequest rejects malformed engine payloads", () => {
  assert.equal(isDesktopMediaGenerateUpdateRequest({ enabled: true, defaultEngine: "auto", engines: [] }), true);
  assert.equal(isDesktopMediaGenerateUpdateRequest({ enabled: true, defaultEngine: "auto", engines: {} }), false);
  assert.equal(isDesktopMediaGenerateUpdateRequest({
    enabled: true,
    defaultEngine: "auto",
    engines: [{ id: "custom", enabled: true, baseUrl: "", model: "", protocol: "invalid" }]
  }), false);
  assert.equal(isDesktopMediaGenerateUpdateRequest({
    enabled: true,
    defaultEngine: "auto",
    engines: [{ id: "auto", enabled: true, baseUrl: "", model: "" }]
  }), false);
});

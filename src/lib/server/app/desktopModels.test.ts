import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import type { RuntimeSettings } from "$lib/server/settings";
import { getModelThinkingLevels } from "$lib/server/providers/modelThinking";
import { getPiCatalogModels } from "$lib/server/providers/piRuntime";
import {
  buildDesktopModelRoutingPatch,
  buildDesktopModelRoutingSettings,
  buildDesktopModelState,
  desktopModelRoutes,
  sanitizeDesktopModelRoute
} from "./desktopModels";

test("desktop model state follows pi 0.82 three-, five-, and seven-level metadata", () => {
  const cases = [
    { provider: "deepseek", modelId: "deepseek-v4-flash", levels: ["off", "high", "max"] },
    { provider: "openai", modelId: "gpt-5.5", levels: ["off", "low", "medium", "high", "xhigh"] },
    { provider: "openai-codex", modelId: "gpt-5.6-sol", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] }
  ] as const;

  for (const fixture of cases) {
    const piModel = getPiCatalogModels(fixture.provider).find((model) => model.id === fixture.modelId);
    assert.ok(piModel, `pi 0.82 should expose ${fixture.provider}/${fixture.modelId}`);
    const settings: RuntimeSettings = {
      ...defaultRuntimeSettings,
      providerMode: "pi",
      piModelProvider: fixture.provider,
      piModelName: fixture.modelId
    };
    const option = buildDesktopModelState(settings).options.find(
      (model) => model.key === `pi|${fixture.provider}|${fixture.modelId}`
    );
    assert.deepEqual(option?.thinkingLevels, getModelThinkingLevels(piModel));
    assert.deepEqual(option?.thinkingLevels, fixture.levels);
  }
});

test("desktop model state exposes labels and keys without provider credentials", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom",
    defaultCustomProviderId: "private-provider",
    customProviders: [{
      id: "private-provider",
      name: "Private Provider",
      enabled: true,
      baseUrl: "https://private.example/v1",
      apiKey: "must-not-leak",
      path: "/chat/completions",
      defaultModel: "private-model",
      models: [{
        id: "private-model",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };

  const state = buildDesktopModelState(settings);
  assert.equal(state.options.some((option) => option.key === "custom|private-provider|private-model"), true);
  assert.equal(JSON.stringify(state).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(state).includes("private.example"), false);
  assert.deepEqual(
    state.options.find((option) => option.key === "custom|private-provider|private-model")?.thinkingLevels,
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
  );
});

test("a built-in model missing from pi metadata falls back to all seven levels", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "pi",
    piModelProvider: "openai",
    piModelName: "future-model",
    customProviders: [{
      id: "openai",
      name: "OpenAI",
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      path: "/chat/completions",
      defaultModel: "future-model",
      models: [{
        id: "future-model",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };

  const option = buildDesktopModelState(settings).options.find(
    (model) => model.key === "pi|openai|future-model"
  );
  assert.deepEqual(option?.thinkingLevels, [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
});

test("sanitizeDesktopModelRoute accepts known routes and falls back to text", () => {
  for (const route of desktopModelRoutes) {
    assert.equal(sanitizeDesktopModelRoute(route), route);
  }
  assert.equal(sanitizeDesktopModelRoute("compaction"), "text");
  assert.equal(sanitizeDesktopModelRoute(""), "text");
  assert.equal(sanitizeDesktopModelRoute(undefined), "text");
});

test("buildDesktopModelState builds each route without leaking credentials", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom",
    defaultCustomProviderId: "private-provider",
    customProviders: [{
      id: "private-provider",
      name: "Private Provider",
      enabled: true,
      baseUrl: "https://private.example/v1",
      apiKey: "must-not-leak",
      path: "/chat/completions",
      defaultModel: "private-model",
      models: [{
        id: "private-model",
        enabled: true,
        tags: ["text", "vision", "stt", "tts"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };

  for (const route of desktopModelRoutes) {
    const state = buildDesktopModelState(settings, route);
    assert.equal(typeof state.currentKey, "string");
    assert.equal(JSON.stringify(state).includes("must-not-leak"), false);
    assert.equal(JSON.stringify(state).includes("private.example"), false);
  }
});

test("desktop model routing exposes advanced settings and credential-safe text options", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    customProviders: [{
      id: "private-provider",
      name: "Private Provider",
      enabled: true,
      baseUrl: "https://private.example/v1",
      apiKey: "must-not-leak",
      path: "/chat/completions",
      defaultModel: "private-model",
      models: [{ id: "private-model", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true }]
    }],
    modelRouting: { ...defaultRuntimeSettings.modelRouting, subagentHaikuModelKey: "custom|private-provider|private-model" },
    timezone: "Asia/Shanghai"
  };
  const routing = buildDesktopModelRoutingSettings(settings);
  assert.equal(routing.subagentHaikuModelKey, "custom|private-provider|private-model");
  assert.equal(routing.timezone, "Asia/Shanghai");
  assert.equal(routing.textOptions.some((option) => option.key === "custom|private-provider|private-model"), true);
  assert.equal(JSON.stringify(routing).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(routing).includes("private.example"), false);
});

test("desktop model routing patch accepts known model keys and rejects unknown keys", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    customProviders: [{
      id: "p1", name: "P1", enabled: true, baseUrl: "https://example.com", apiKey: "secret", path: "/v1/chat/completions", defaultModel: "m1",
      models: [{ id: "m1", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true }]
    }]
  };
  const patch = buildDesktopModelRoutingPatch(settings, {
    compactionModelKey: "unknown",
    subagentHaikuModelKey: "custom|p1|m1",
    subagentSonnetModelKey: "",
    subagentOpusModelKey: "",
    subagentThinkingModelKey: "",
    modelFallback: { mode: "any-enabled", firstTokenTimeoutMs: 45000 },
    defaultThinkingLevel: "high",
    compaction: { enabled: true, thresholdPercent: 75, reserveTokens: 4096, keepRecentTokens: 8192, defaultContextWindow: 128000 },
    timezone: "Asia/Shanghai"
  });
  assert.equal(patch.modelRouting.compactionModelKey, "");
  assert.equal(patch.modelRouting.subagentHaikuModelKey, "custom|p1|m1");
  assert.equal(patch.modelFallback.mode, "any-enabled");
  assert.equal(patch.defaultThinkingLevel, "high");
  assert.equal(patch.compaction.thresholdPercent, 75);
});

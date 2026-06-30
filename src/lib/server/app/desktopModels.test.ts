import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import type { RuntimeSettings } from "$lib/server/settings";
import {
  buildDesktopModelRoutingPatch,
  buildDesktopModelRoutingSettings,
  buildDesktopModelState,
  desktopModelRoutes,
  sanitizeDesktopModelRoute
} from "./desktopModels";

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
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };

  const state = buildDesktopModelState(settings);
  assert.equal(state.options.some((option) => option.key === "custom|private-provider|private-model"), true);
  assert.equal(JSON.stringify(state).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(state).includes("private.example"), false);
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

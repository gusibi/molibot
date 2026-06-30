import assert from "node:assert/strict";
import test from "node:test";
import type { TtsGenerateSettings } from "$lib/server/settings/schema";
import {
  buildDesktopTtsMacosProvider,
  buildDesktopTtsSummary,
  buildDesktopTtsXiaomiProvider,
  updateDesktopTtsSettings
} from "./desktopTtsGenerate";

test("buildDesktopTtsMacosProvider has no key/model/baseUrl and keeps voice/format", () => {
  const provider = buildDesktopTtsMacosProvider({ enabled: true, voice: "Samantha", format: "m4a" });
  assert.equal(provider.id, "macos");
  assert.equal(provider.enabled, true);
  assert.equal(provider.voice, "Samantha");
  assert.equal(provider.format, "m4a");
  assert.equal(provider.hasApiKey, false);
  assert.equal(provider.model, "");
  assert.equal(provider.baseUrl, "");
});

test("buildDesktopTtsXiaomiProvider replaces apiKey with hasApiKey and keeps baseUrl/model", () => {
  const provider = buildDesktopTtsXiaomiProvider({
    enabled: true,
    apiKey: "mimo-SECRET-KEY",
    baseUrl: "https://api.mimo.example",
    model: "mimo-tts-1",
    voice: "alloy",
    format: "mp3"
  });
  assert.equal(provider.id, "xiaomi");
  assert.equal(provider.enabled, true);
  assert.equal(provider.hasApiKey, true);
  assert.equal(provider.baseUrl, "https://api.mimo.example");
  assert.equal(provider.model, "mimo-tts-1");
  assert.equal(provider.voice, "alloy");
  assert.equal(provider.format, "mp3");

  const serialized = JSON.stringify(provider);
  assert.equal(serialized.includes("mimo-SECRET-KEY"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopTtsXiaomiProvider reports a blank key via hasApiKey=false", () => {
  const provider = buildDesktopTtsXiaomiProvider({
    enabled: false,
    apiKey: "   ",
    baseUrl: "",
    model: "",
    voice: "",
    format: "wav"
  });
  assert.equal(provider.hasApiKey, false);
});

test("buildDesktopTtsSummary projects both providers in order without leaking the key", () => {
  const summary = buildDesktopTtsSummary({
    enabled: true,
    defaultProvider: "macos",
    providers: {
      macos: { enabled: true, voice: "Samantha", format: "m4a" },
      xiaomi: { enabled: true, apiKey: "mimo-SECRET-KEY", baseUrl: "https://api.mimo.example", model: "mimo-tts-1", voice: "alloy", format: "mp3" }
    }
  } as unknown as TtsGenerateSettings);

  assert.equal(summary.enabled, true);
  assert.equal(summary.defaultProvider, "macos");
  assert.deepEqual(summary.providers.map((p) => p.id), ["macos", "xiaomi"]);
  assert.equal(summary.providers[1].hasApiKey, true);
  assert.equal(JSON.stringify(summary).includes("mimo-SECRET-KEY"), false);
});

test("updateDesktopTtsSettings preserves, replaces, and clears the Xiaomi API key", () => {
  const current = {
    enabled: true,
    defaultProvider: "macos",
    providers: {
      macos: { enabled: true, voice: "Samantha", format: "m4a" },
      xiaomi: { enabled: true, apiKey: "keep-me", baseUrl: "https://old.example", model: "old", voice: "old", format: "mp3" }
    }
  } as unknown as TtsGenerateSettings;
  const baseRequest = {
    enabled: true,
    defaultProvider: "xiaomi",
    providers: [
      { id: "macos", enabled: true, voice: "Tingting", format: "wav", baseUrl: "", model: "" },
      { id: "xiaomi", enabled: true, voice: "new", format: "mp3", baseUrl: "https://new.example", model: "new" }
    ]
  };

  assert.equal(updateDesktopTtsSettings(current, baseRequest).providers.xiaomi.apiKey, "keep-me");
  assert.equal(updateDesktopTtsSettings(current, {
    ...baseRequest,
    providers: baseRequest.providers.map((provider) => provider.id === "xiaomi" ? { ...provider, apiKey: "new-key" } : provider)
  }).providers.xiaomi.apiKey, "new-key");
  assert.equal(updateDesktopTtsSettings(current, {
    ...baseRequest,
    providers: baseRequest.providers.map((provider) => provider.id === "xiaomi" ? { ...provider, clearApiKey: true } : provider)
  }).providers.xiaomi.apiKey, "");
});

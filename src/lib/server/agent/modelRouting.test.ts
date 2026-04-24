import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings, type RuntimeSettings } from "../settings/index.js";
import { resolveSttTarget } from "./stt.js";
import { resolveVisionFallbackTarget } from "./vision-fallback.js";

function settingsWithProviders(patch: Partial<RuntimeSettings>): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    ...patch,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      ...(patch.modelRouting ?? {})
    },
    modelFallback: {
      ...defaultRuntimeSettings.modelFallback,
      ...(patch.modelFallback ?? {})
    },
    customProviders: patch.customProviders ?? []
  };
}

test("STT route ignores disabled providers", () => {
  const settings = settingsWithProviders({
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      sttModelKey: "custom|disabled-stt|stt-a"
    },
    customProviders: [
      {
        id: "disabled-stt",
        name: "Disabled STT",
        enabled: false,
        baseUrl: "https://stt.example/v1",
        apiKey: "stt-key",
        path: "/audio/transcriptions",
        defaultModel: "stt-a",
        models: [
          { id: "stt-a", tags: ["stt"], supportedRoles: ["system", "user", "assistant", "tool"] }
        ]
      }
    ]
  });

  assert.equal(resolveSttTarget(settings), null);
});

test("vision fallback route ignores disabled providers", () => {
  const settings = settingsWithProviders({
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      visionModelKey: "custom|disabled-vision|vision-a"
    },
    customProviders: [
      {
        id: "disabled-vision",
        name: "Disabled Vision",
        enabled: false,
        baseUrl: "https://vision.example/v1",
        apiKey: "vision-key",
        path: "/chat/completions",
        defaultModel: "vision-a",
        models: [
          { id: "vision-a", tags: ["vision"], supportedRoles: ["system", "user", "assistant", "tool"] }
        ]
      }
    ]
  });

  assert.equal(resolveVisionFallbackTarget(settings), null);
});

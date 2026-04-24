import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "./defaults.js";
import { buildModelOptions, currentModelKey, switchModelSelection } from "./modelSwitch.js";
import type { RuntimeSettings } from "./index.js";

test("buildModelOptions treats enabled built-in providers as pi routes", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    piModelProvider: "anthropic" as const,
    piModelName: "claude-sonnet-4-20250514",
    customProviders: [
      {
        id: "google",
        name: "[Built-in] google",
        enabled: true,
        baseUrl: "",
        apiKey: "google-key",
        path: "/v1/chat/completions",
        defaultModel: "gemini-flash-latest",
        models: [
          {
            id: "gemini-flash-latest",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      },
      {
        id: "grok2api",
        name: "Grok2Api",
        enabled: true,
        baseUrl: "http://localhost:8001/v1",
        apiKey: "custom-key",
        path: "/chat/completions",
        defaultModel: "grok-4.20-fast",
        models: [
          {
            id: "grok-4.20-fast",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ]
  };

  const options = buildModelOptions(settings, "text");
  assert.equal(options.some((option) => option.key === "pi|google|gemini-flash-latest"), true);
  assert.equal(options.some((option) => option.key === "custom|google|gemini-flash-latest"), false);
  assert.equal(options.some((option) => option.key === "custom|grok2api|grok-4.20-fast"), true);
});

test("switchModelSelection keeps built-in switch on pi route even when providerMode is custom", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    piModelProvider: "anthropic" as const,
    piModelName: "claude-sonnet-4-20250514",
    customProviders: [
      {
        id: "google",
        name: "[Built-in] google",
        enabled: true,
        baseUrl: "",
        apiKey: "google-key",
        path: "/v1/chat/completions",
        defaultModel: "gemini-flash-latest",
        models: [
          {
            id: "gemini-flash-latest",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ],
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: ""
    }
  };

  const switched = switchModelSelection({
    settings,
    route: "text",
    selector: "pi|google|gemini-flash-latest",
    updateSettings: (patch) => ({ ...settings, ...patch })
  });

  assert.ok(switched);
  assert.equal(switched.selected.key, "pi|google|gemini-flash-latest");
  assert.equal(switched.settings.providerMode, "custom");
  assert.equal(switched.settings.piModelProvider, "google");
  assert.equal(switched.settings.piModelName, "gemini-flash-latest");
  assert.equal(switched.settings.modelRouting.textModelKey, "pi|google|gemini-flash-latest");
});

test("currentModelKey prefers configured built-in default model over stale pi fallback value", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "pi" as const,
    piModelProvider: "google-vertex" as const,
    piModelName: "gemini-1.5-flash",
    customProviders: [
      {
        id: "google-vertex",
        name: "[Built-in] google-vertex",
        enabled: true,
        baseUrl: "",
        apiKey: "vertex-key",
        path: "/v1/chat/completions",
        defaultModel: "gemini-3.1-flash-lite-preview",
        models: [
          {
            id: "gemini-3.1-flash-lite-preview",
            tags: ["text", "vision", "tool"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ],
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: ""
    }
  };

  assert.equal(
    currentModelKey(settings, "text"),
    "pi|google-vertex|gemini-3.1-flash-lite-preview"
  );
});

test("currentModelKey does not treat built-in or STT-only providers as custom text default", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    piModelProvider: "openrouter" as const,
    piModelName: "text-fallback",
    defaultCustomProviderId: "siliconflow-stt",
    customProviders: [
      {
        id: "google",
        name: "[Built-in] google",
        enabled: true,
        baseUrl: "",
        apiKey: "google-key",
        path: "/v1/chat/completions",
        defaultModel: "gemini-flash-latest",
        models: [
          {
            id: "gemini-flash-latest",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          }
        ]
      },
      {
        id: "siliconflow-stt",
        name: "STT only",
        enabled: true,
        baseUrl: "https://stt.example",
        apiKey: "stt-key",
        path: "/v1/audio/transcriptions",
        defaultModel: "TeleAI/TeleSpeechASR",
        models: [
          {
            id: "TeleAI/TeleSpeechASR",
            tags: ["stt"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          }
        ]
      }
    ],
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: ""
    }
  };

  assert.equal(currentModelKey(settings, "text"), "pi|openrouter|text-fallback");
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantStreamEvent } from "./assistantStream.js";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/schema.js";
import { decideVisionRouting, resolveModelSelection } from "./runner.js";

test("applyAssistantStreamEvent resets buffered assistant text on a new assistant message", () => {
  const afterDelta = applyAssistantStreamEvent(
    { assistantTextStreamed: false, streamedAssistantText: "" },
    { type: "text_delta", delta: "partial answer" }
  );
  assert.equal(afterDelta.assistantTextStreamed, true);
  assert.equal(afterDelta.streamedAssistantText, "partial answer");

  const afterRestart = applyAssistantStreamEvent(afterDelta, {
    type: "message_start",
    role: "assistant"
  });
  assert.deepEqual(afterRestart, {
    assistantTextStreamed: false,
    streamedAssistantText: ""
  });
});

test("decideVisionRouting prefers an explicit dedicated vision route over a vision-capable text route", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5-pro",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5-pro",
        models: [
          {
            id: "mimo-v2.5-pro",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          },
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "vision");
  assert.equal(decision.selection.modelId, "mimo-v2.5");
  assert.equal(decision.sendImagesNatively, true);
});

test("decideVisionRouting keeps the text route when the vision route resolves to the same model", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5",
        models: [
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "text");
  assert.equal(decision.selection.modelId, "mimo-v2.5");
  assert.equal(decision.sendImagesNatively, true);
});

test("decideVisionRouting does not send custom images natively before vision verification passes", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5-pro",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5-pro",
        models: [
          {
            id: "mimo-v2.5-pro",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant"]
          },
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "fallback");
  assert.equal(decision.selection.modelId, "mimo-v2.5-pro");
  assert.equal(decision.sendImagesNatively, false);
});

test("custom vision models advertise image input only after vision verification passes", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "openai-compatible" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/chat/completions",
        defaultModel: "mimo-v2.5",
        models: [
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const unverified = resolveModelSelection(settings, "vision");
  assert.deepEqual(unverified.model.input, ["text"]);

  settings.customProviders[0].models[0].verification = { vision: "passed" };
  const verified = resolveModelSelection(settings, "vision");
  assert.deepEqual(verified.model.input, ["text", "image"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantStreamEvent } from "./assistantStream.js";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/schema.js";
import { decideVisionRouting } from "./runner.js";

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

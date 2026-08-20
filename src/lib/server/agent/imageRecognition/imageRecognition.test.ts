import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import {
  recognizeImage,
  type ImageRecognitionEngineRun
} from "$lib/server/agent/imageRecognition/imageRecognition.js";

function settings(defaultEngine: string | "auto" = "auto"): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    imageRecognition: {
      enabled: true,
      defaultEngine,
      engineOrder: ["fast", "accurate", "disabled"],
      engines: {
        fast: { enabled: true, name: "Fast", modelKey: "custom|vision-a|model-a" },
        accurate: { enabled: true, name: "Accurate", modelKey: "custom|vision-b|model-b" },
        disabled: { enabled: false, name: "Disabled", modelKey: "custom|vision-c|model-c" }
      }
    }
  };
}

test("recognizeImage tries enabled API engines in configured order and records failover", async () => {
  const calls: string[] = [];
  const runEngine: ImageRecognitionEngineRun = async ({ engineId }) => {
    calls.push(engineId);
    if (engineId === "fast") throw new Error("503: upstream unavailable");
    return {
      text: "The screenshot shows a settings page.",
      providerId: "vision-b",
      modelId: "model-b"
    };
  };

  const result = await recognizeImage({
    channel: "test",
    settings: settings(),
    image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    prompt: "Describe the UI",
    label: "screen.png",
    runEngine
  });

  assert.deepEqual(calls, ["fast", "accurate"]);
  assert.equal(result.text, "The screenshot shows a settings page.");
  assert.equal(result.engineId, "accurate");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, true);
  assert.match(result.warnings[0], /fast/);
});

test("recognizeImage pins a selected engine and never falls through to another", async () => {
  const calls: string[] = [];
  await assert.rejects(
    recognizeImage({
      channel: "test",
      settings: settings("fast"),
      image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      runEngine: async ({ engineId }) => {
        calls.push(engineId);
        throw new Error("401: invalid credential");
      }
    }),
    /fast.*401: invalid credential/
  );
  assert.deepEqual(calls, ["fast"]);
});

test("recognizeImage refuses disabled or empty recognition configuration before an engine call", async () => {
  let called = false;
  await assert.rejects(
    recognizeImage({
      channel: "test",
      settings: {
        ...settings(),
        imageRecognition: { ...settings().imageRecognition, enabled: false }
      },
      image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      runEngine: async () => {
        called = true;
        return { text: "must not run" };
      }
    }),
    /disabled/i
  );
  assert.equal(called, false);
});

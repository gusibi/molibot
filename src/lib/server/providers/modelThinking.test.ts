import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import {
  getModelThinkingLevels,
  resolveModelThinkingLevel
} from "$lib/server/providers/modelThinking.js";

function model(input: Partial<Model<any>>): Model<any> {
  return {
    id: "test-model",
    name: "Test model",
    api: "openai-responses",
    provider: "test",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    ...input
  } as Model<any>;
}

test("model thinking levels preserve pi's explicit seven-level capability map", () => {
  const configured = model({
    thinkingLevelMap: {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max"
    }
  });

  assert.deepEqual(getModelThinkingLevels(configured), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.equal(resolveModelThinkingLevel(configured, "xhigh"), "xhigh");
});

test("reasoning models without an explicit map default to seven identity levels", () => {
  const configured = model({ thinkingLevelMap: undefined });
  assert.deepEqual(getModelThinkingLevels(configured), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.equal(resolveModelThinkingLevel(configured, "max"), "max");
});

test("model thinking resolution uses pi's nearest supported-level clamp", () => {
  const configured = model({
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null
    }
  });

  assert.deepEqual(getModelThinkingLevels(configured), ["low", "high"]);
  assert.equal(resolveModelThinkingLevel(configured, "off"), "low");
  assert.equal(resolveModelThinkingLevel(configured, "medium"), "high");
  assert.equal(resolveModelThinkingLevel(configured, "max"), "high");
});

test("models without an explicit map expose seven levels even when reasoning metadata is false", () => {
  const configured = model({ reasoning: false });
  assert.deepEqual(getModelThinkingLevels(configured), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.equal(resolveModelThinkingLevel(configured, "max"), "max");
});

test("an invalid all-disabled map degrades safely to off", () => {
  const configured = model({
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null
    }
  });
  assert.deepEqual(getModelThinkingLevels(configured), ["off"]);
  assert.equal(resolveModelThinkingLevel(configured, "high"), "off");
});

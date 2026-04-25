import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDirectReasoningParams,
  buildCustomProviderCompat
} from "./customThinking.js";
import { resolveCustomProviderThinkingFormat } from "../settings/thinking.js";

test("deepseek format uses upstream-compatible thinking parameters", () => {
  const provider = {
    supportsThinking: true,
    thinkingFormat: "deepseek" as const,
    reasoningEffortMap: {
      low: "high",
      medium: "high",
      high: "high"
    }
  };

  assert.deepEqual(
    applyDirectReasoningParams({ model: "deepseek-chat" }, provider, "low"),
    {
      model: "deepseek-chat",
      reasoning_effort: "high",
      thinking: { type: "enabled" }
    }
  );
  assert.deepEqual(buildCustomProviderCompat(provider), {
    thinkingFormat: "deepseek",
    reasoningEffortMap: {
      low: "high",
      medium: "high",
      high: "high"
    }
  });
});

test("deepseek format defaults low and medium effort to high", () => {
  const provider = {
    supportsThinking: true,
    thinkingFormat: "deepseek" as const,
    reasoningEffortMap: undefined
  };

  assert.deepEqual(
    applyDirectReasoningParams({ model: "deepseek-chat" }, provider, "medium"),
    {
      model: "deepseek-chat",
      reasoning_effort: "high",
      thinking: { type: "enabled" }
    }
  );
  assert.deepEqual(buildCustomProviderCompat(provider), {
    thinkingFormat: "deepseek",
    reasoningEffortMap: {
      low: "high",
      medium: "high",
      high: "high"
    }
  });
});

test("unset thinking format does not infer vendor-specific request params", () => {
  const provider = {
    id: "custom-deepseek",
    name: "DeepSeek-compatible custom endpoint",
    baseUrl: "https://api.deepseek.example",
    supportsThinking: true,
    thinkingFormat: undefined,
    reasoningEffortMap: undefined
  };

  assert.deepEqual(
    applyDirectReasoningParams({ model: "deepseek-chat" }, provider, "medium"),
    {
      model: "deepseek-chat",
      reasoning_effort: "medium"
    }
  );
  assert.equal(buildCustomProviderCompat(provider), undefined);
});

test("known provider presets map old thinking-type value to deepseek format", () => {
  assert.equal(
    resolveCustomProviderThinkingFormat("thinking-type", {
      id: "custom-deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.example"
    }),
    "deepseek"
  );
  assert.equal(
    resolveCustomProviderThinkingFormat("", {
      id: "custom-deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.example"
    }),
    "deepseek"
  );
  assert.equal(
    resolveCustomProviderThinkingFormat("openai", {
      id: "custom-deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.example"
    }),
    "openai"
  );
});

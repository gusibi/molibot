import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDirectReasoningParams,
  buildCustomProviderCompat,
  normalizeThinkingTypePayload
} from "./customThinking.js";
import { resolveCustomProviderThinkingFormat } from "../settings/thinking.js";

test("thinking-type format uses thinking.type instead of reasoning_effort", () => {
  const provider = {
    supportsThinking: true,
    thinkingFormat: "thinking-type" as const,
    reasoningEffortMap: undefined
  };

  assert.deepEqual(
    applyDirectReasoningParams({ model: "deepseek-chat" }, provider, "high"),
    {
      model: "deepseek-chat",
      thinking: { type: "enabled" }
    }
  );
  assert.deepEqual(buildCustomProviderCompat(provider), {
    supportsReasoningEffort: false,
    reasoningEffortMap: undefined
  });
});

test("unset thinking format does not infer vendor-specific behavior", () => {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
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

test("known provider presets infer thinking format outside request building", () => {
  assert.equal(
    resolveCustomProviderThinkingFormat("", {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com"
    }),
    "thinking-type"
  );
  assert.equal(
    resolveCustomProviderThinkingFormat("openai", {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com"
    }),
    "openai"
  );
});

test("thinking-type payload preserves reasoning_content for history replay", () => {
  const payload = {
    model: "deepseek-chat",
    reasoning_effort: "high",
    messages: [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "done",
        reasoning_content: "stale"
      },
      { role: "user", content: "next question" },
      {
        role: "assistant",
        content: "",
        reasoning_content: "needed",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }]
      },
      { role: "tool", tool_call_id: "call_1", content: "result" }
    ]
  };

  const normalized = normalizeThinkingTypePayload(payload, "medium") as typeof payload & {
    thinking?: { type: string };
  };

  assert.equal("reasoning_effort" in normalized, false);
  assert.deepEqual(normalized.thinking, { type: "enabled" });
  assert.equal(normalized.messages[1].reasoning_content, "stale");
  assert.equal(normalized.messages[3].reasoning_content, "needed");
});

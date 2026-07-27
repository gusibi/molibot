import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDirectReasoningParams,
  buildCustomProviderCompat,
  resolveThinkingLevel
} from "$lib/server/providers/customThinking.js";
import { resolveCustomProviderThinkingFormat } from "$lib/server/settings/thinking.js";

test("custom provider strengths pass through unchanged without a mapping table", () => {
  assert.deepEqual(
    applyDirectReasoningParams({ model: "reasoner" }, { thinkingFormat: "openai" }, "max"),
    { model: "reasoner", reasoning_effort: "max" }
  );
  assert.deepEqual(
    applyDirectReasoningParams({ model: "reasoner" }, { thinkingFormat: "openrouter" }, "xhigh"),
    { model: "reasoner", reasoning: { effort: "xhigh" } }
  );
  assert.deepEqual(
    applyDirectReasoningParams({ model: "reasoner" }, { thinkingFormat: "deepseek" }, "minimal"),
    { model: "reasoner", reasoning_effort: "minimal", thinking: { type: "enabled" } }
  );
});

test("off adds no reasoning parameter", () => {
  assert.deepEqual(
    applyDirectReasoningParams({ model: "reasoner" }, { thinkingFormat: "openai" }, "off"),
    { model: "reasoner" }
  );
});

test("custom thinking selection is not clamped before the upstream request", () => {
  assert.equal(resolveThinkingLevel({ defaultThinkingLevel: "max" }), "max");
});

test("custom compat keeps request shape without a strength mapping", () => {
  assert.deepEqual(buildCustomProviderCompat({ thinkingFormat: "deepseek" }), {
    thinkingFormat: "deepseek"
  });
  assert.equal(buildCustomProviderCompat({ thinkingFormat: undefined }), undefined);
});

test("known provider presets retain the old thinking-type format migration", () => {
  assert.equal(
    resolveCustomProviderThinkingFormat("thinking-type", {
      id: "custom-deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.example"
    }),
    "deepseek"
  );
});

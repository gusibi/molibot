import assert from "node:assert/strict";
import test from "node:test";
import { isSameModelFamily, modelFamilyOf } from "$lib/server/agent/tools/modelFamily.js";

test("model family follows the model lineage, not the provider that serves it", () => {
  // The same lineage reached through an aggregator or a private proxy is still
  // the same lineage — this is the whole point of the check.
  assert.equal(modelFamilyOf({ provider: "anthropic", model: "claude-sonnet-4-5" }), "claude");
  assert.equal(modelFamilyOf({ provider: "openrouter", model: "anthropic/claude-sonnet-4-5" }), "claude");
  assert.equal(modelFamilyOf({ provider: "amazon-bedrock", model: "us.anthropic.claude-sonnet-4-5-v1:0" }), "claude");
  assert.equal(modelFamilyOf({ provider: "my-proxy", model: "claude-sonnet-4-5" }), "claude");

  assert.equal(modelFamilyOf({ provider: "openai", model: "gpt-4.1-mini" }), "gpt");
  assert.equal(modelFamilyOf({ provider: "openai", model: "o3-mini" }), "gpt");
  assert.equal(modelFamilyOf({ provider: "groq", model: "openai/gpt-oss-120b" }), "gpt");
  assert.equal(modelFamilyOf({ provider: "google", model: "gemini-flash-latest" }), "gemini");
  assert.equal(modelFamilyOf({ provider: "deepseek", model: "deepseek-v4-flash" }), "deepseek");
  assert.equal(modelFamilyOf({ provider: "zai", model: "glm-4.6" }), "glm");
  assert.equal(modelFamilyOf({ provider: "kimi-coding", model: "kimi-k2-turbo" }), "kimi");
  assert.equal(modelFamilyOf({ provider: "xai", model: "grok-4" }), "grok");
});

test("an unrecognized model falls back to its provider so unrelated providers stay distinct", () => {
  assert.equal(modelFamilyOf({ provider: "my-proxy", model: "house-model-v2" }), "provider:my-proxy");
  assert.equal(
    isSameModelFamily(
      { provider: "my-proxy", model: "house-model-v2" },
      { provider: "other-proxy", model: "house-model-v2" }
    ),
    false
  );
  // Two unknown models behind one provider are assumed related; that is the
  // conservative answer for an independence check.
  assert.equal(
    isSameModelFamily(
      { provider: "my-proxy", model: "house-model-v2" },
      { provider: "my-proxy", model: "house-model-v3" }
    ),
    true
  );
});

test("family comparison is what decides independence, not the provider id", () => {
  assert.equal(
    isSameModelFamily(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "openrouter", model: "anthropic/claude-opus-4-1" }
    ),
    true,
    "a different provider serving the same lineage is not an independent reviewer"
  );
  assert.equal(
    isSameModelFamily(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ),
    false
  );
});

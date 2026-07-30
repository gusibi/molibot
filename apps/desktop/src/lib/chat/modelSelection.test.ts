import test from "node:test";
import assert from "node:assert/strict";
import { lastTranscriptModelKey, optionKeyForTranscriptModel } from "./modelSelection";

const options = [
  { key: "custom|cli-proxy-api|gemini-3.5-flash-low" },
  { key: "custom|cli-proxy-api|deepseek-v4-pro" },
  { key: "custom|custom-qiniu|deepseek/deepseek-v4-pro" },
  { key: "pi|anthropic|claude-3-5-haiku-20241022" }
];

test("maps a transcript's provider/model pair onto the composer's routing key", () => {
  assert.equal(
    optionKeyForTranscriptModel("cli-proxy-api/deepseek-v4-pro", options),
    "custom|cli-proxy-api|deepseek-v4-pro"
  );
  // Model ids contain slashes; only the FIRST one separates provider from model.
  assert.equal(
    optionKeyForTranscriptModel("custom-qiniu/deepseek/deepseek-v4-pro", options),
    "custom|custom-qiniu|deepseek/deepseek-v4-pro"
  );
  assert.equal(
    optionKeyForTranscriptModel("anthropic/claude-3-5-haiku-20241022", options),
    "pi|anthropic|claude-3-5-haiku-20241022"
  );
});

test("unresolvable labels select nothing so callers keep their default", () => {
  assert.equal(optionKeyForTranscriptModel("cli-proxy-api/removed-model", options), "");
  assert.equal(optionKeyForTranscriptModel("deepseek-v4-pro", options), "");
  assert.equal(optionKeyForTranscriptModel("/deepseek-v4-pro", options), "");
  assert.equal(optionKeyForTranscriptModel("cli-proxy-api/", options), "");
  assert.equal(optionKeyForTranscriptModel(undefined, options), "");
});

test("picks the model that answered LAST, skipping user turns and unknown models", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", model: "cli-proxy-api/gemini-3.5-flash-low" },
    { role: "user", content: "switch" },
    { role: "assistant", model: "cli-proxy-api/deepseek-v4-pro" },
    { role: "user", content: "again" }
  ];
  assert.equal(lastTranscriptModelKey(messages, options), "custom|cli-proxy-api|deepseek-v4-pro");

  // A last reply from a model that is no longer listed falls back to the newest
  // resolvable one instead of leaving the selector empty.
  const withRemoved = [...messages, { role: "assistant", model: "cli-proxy-api/removed-model" }];
  assert.equal(lastTranscriptModelKey(withRemoved, options), "custom|cli-proxy-api|deepseek-v4-pro");

  assert.equal(lastTranscriptModelKey([{ role: "user", content: "hi" }], options), "");
  assert.equal(lastTranscriptModelKey([], options), "");
});

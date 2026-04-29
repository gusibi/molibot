import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicBaseUrl,
  buildAnthropicCompatibleHeaders,
  buildOpenAICompatibleHeaders
} from "./customProtocol.js";

test("custom protocol helpers build documented image-capable request headers", () => {
  assert.deepEqual(buildOpenAICompatibleHeaders({ apiKey: "test-key" }), {
    "Content-Type": "application/json",
    Authorization: "Bearer test-key"
  });
  assert.deepEqual(buildAnthropicCompatibleHeaders({ apiKey: "test-key" }), {
    "Content-Type": "application/json",
    "x-api-key": "test-key",
    "anthropic-version": "2023-06-01"
  });
});

test("MiMo Anthropic path preserves the /anthropic prefix for SDK baseUrl", () => {
  assert.equal(
    buildAnthropicBaseUrl(
      "https://api.xiaomimimo.com",
      "/anthropic/v1/messages"
    ),
    "https://api.xiaomimimo.com/anthropic"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeOptionalRuntimeThinkingLevel,
  sanitizeRuntimeThinkingLevel
} from "./thinking";

test("request thinking preserves an omitted value as no override", () => {
  assert.equal(sanitizeOptionalRuntimeThinkingLevel(undefined), undefined);
  assert.equal(sanitizeOptionalRuntimeThinkingLevel(""), undefined);
  assert.equal(sanitizeOptionalRuntimeThinkingLevel("unexpected"), undefined);
});

test("request thinking keeps an explicit supported override", () => {
  assert.equal(sanitizeOptionalRuntimeThinkingLevel(" off "), "off");
  assert.equal(sanitizeOptionalRuntimeThinkingLevel("HIGH"), "high");
});

test("stored thinking settings retain their configured fallback semantics", () => {
  assert.equal(sanitizeRuntimeThinkingLevel(undefined, "low"), "low");
});

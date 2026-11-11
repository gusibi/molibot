import assert from "node:assert/strict";
import test from "node:test";
import { createStreamRateMeter, estimateTokens } from "./streamingRate";

test("estimateTokens weighs CJK heavier than latin", () => {
  assert.ok(estimateTokens("你好世界，测试一下") > estimateTokens("hello world, testing"));
  assert.equal(estimateTokens(""), 1);
  assert.equal(estimateTokens("abcd".repeat(100)), Math.round(400 / 4));
});

test("meter reports the sliding-window rate while text grows", () => {
  const meter = createStreamRateMeter();
  meter.push(0, 0);
  meter.push(0, 1000);
  meter.push(500, 2000);
  meter.push(1000, 3000);
  // 1000 chars over the 2s span the window still covers.
  const rate = meter.tokensPerSecond(3000, 1);
  assert.equal(Math.round(rate), 500);
});

test("meter rate decays to zero once growth stops", () => {
  const meter = createStreamRateMeter();
  meter.push(0, 0);
  meter.push(0, 1000);
  meter.push(500, 2000);
  assert.ok(meter.tokensPerSecond(2000, 1) > 0);
  meter.push(500, 3000);
  meter.push(500, 4000);
  assert.equal(meter.tokensPerSecond(4000, 1), 0);
});

test("meter rate goes stale when pushes stop arriving", () => {
  const meter = createStreamRateMeter();
  meter.push(0, 0);
  meter.push(0, 1000);
  meter.push(400, 2000);
  assert.ok(meter.tokensPerSecond(2500, 1) > 0);
  // No push for 2.5s: whatever the window held, it is not "live" anymore.
  assert.equal(meter.tokensPerSecond(5000, 1), 0);
});

test("meter restarts when a new turn rewinds the cumulative length", () => {
  const meter = createStreamRateMeter();
  meter.push(0, 0);
  meter.push(0, 1000);
  meter.push(1000, 2000);
  meter.push(50, 3000); // new turn: total dropped back to a short prefix
  assert.equal(meter.tokensPerSecond(3000, 1), 0);
  meter.push(150, 4000);
  assert.ok(meter.tokensPerSecond(4000, 1) > 0);
});

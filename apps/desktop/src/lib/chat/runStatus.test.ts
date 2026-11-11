import assert from "node:assert/strict";
import test from "node:test";
import { createRunStatusMeter, formatRunRate, formatRunTokens } from "./runStatus";

test("the meter reports tokens, rate and the answering phase while prose grows", () => {
  const meter = createRunStatusMeter();
  meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  meter.tick({ now: 1000, text: "hello world, this is the answer", thinking: "", hasRunningActivity: false });
  const snapshot = meter.tick({ now: 2000, text: "hello world, this is the answer and more text", thinking: "", hasRunningActivity: false });
  assert.equal(snapshot.phase, "answering");
  assert.ok(snapshot.tokens > 0);
  assert.ok(snapshot.tokensPerSecond > 0);
  assert.equal(snapshot.idleTicks, 0);
});

test("thinking growth labels the turn as thinking until prose arrives", () => {
  const meter = createRunStatusMeter();
  meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  const thinking = meter.tick({ now: 1000, text: "", thinking: "考虑一下这个问题该怎么回答", hasRunningActivity: false });
  assert.equal(thinking.phase, "thinking");
  const answering = meter.tick({
    now: 2000,
    text: "这是回答",
    thinking: "考虑一下这个问题该怎么回答",
    hasRunningActivity: false
  });
  assert.equal(answering.phase, "answering");
});

test("a running tool owns the phase regardless of recent prose", () => {
  const meter = createRunStatusMeter();
  meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  meter.tick({ now: 1000, text: "partial answer", thinking: "", hasRunningActivity: false });
  const snapshot = meter.tick({ now: 2000, text: "partial answer", thinking: "", hasRunningActivity: true });
  assert.equal(snapshot.phase, "tool");
});

test("silence becomes an honest waiting phase only after the idle threshold", () => {
  const meter = createRunStatusMeter({ idleTicksBeforeWaiting: 3 });
  meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  meter.tick({ now: 1000, text: "answer", thinking: "", hasRunningActivity: false });
  assert.notEqual(meter.tick({ now: 2000, text: "answer", thinking: "", hasRunningActivity: false }).phase, "waiting");
  assert.notEqual(meter.tick({ now: 3000, text: "answer", thinking: "", hasRunningActivity: false }).phase, "waiting");
  assert.notEqual(meter.tick({ now: 4000, text: "answer", thinking: "", hasRunningActivity: false }).phase, "waiting");
  const idle = meter.tick({ now: 5000, text: "answer", thinking: "", hasRunningActivity: false });
  assert.equal(idle.phase, "waiting");
  assert.equal(idle.tokensPerSecond, 0);
  assert.ok(idle.tokens > 0);
});

test("the pre-stream gap reads as starting, not waiting", () => {
  const meter = createRunStatusMeter();
  const first = meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  assert.equal(first.phase, "starting");
  assert.equal(first.tokens, 0);
});

test("replaced text restarts the window instead of reporting a phantom rate", () => {
  const meter = createRunStatusMeter();
  meter.tick({ now: 0, text: "", thinking: "", hasRunningActivity: false });
  meter.tick({ now: 1000, text: "a long provisional answer", thinking: "", hasRunningActivity: false });
  const short = meter.tick({ now: 2000, text: "short", thinking: "", hasRunningActivity: false });
  assert.equal(short.tokensPerSecond, 0);
  assert.equal(short.phase, "answering");
});

test("token and rate formatting stays compact and stable", () => {
  assert.equal(formatRunTokens(0), "0");
  assert.equal(formatRunTokens(320.4), "320");
  assert.equal(formatRunTokens(12_345), "12.3k");
  assert.equal(formatRunTokens(123_456), "123k");
  assert.equal(formatRunTokens(1_234_567), "1.2m");
  assert.equal(formatRunRate(0), "0.0");
  assert.equal(formatRunRate(4.26), "4.3");
  assert.equal(formatRunRate(42.6), "43");
});

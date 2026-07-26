import assert from "node:assert/strict";
import test from "node:test";
import { settleWithCooperativeTimeout } from "$lib/server/agent/core/cooperativeTimeout.js";

test("cooperative timeout accepts settlement inside the abort grace window", async () => {
  let release: (() => void) | undefined;
  const run = new Promise<string>((resolve) => { release = () => resolve("done"); });
  const result = await settleWithCooperativeTimeout(run, {
    timeoutMs: 1,
    settleGraceMs: 20,
    onTimeout: () => { setTimeout(() => release?.(), 1); }
  });
  assert.deepEqual(result, { status: "settled", value: "done" });
});

test("cooperative timeout returns when cancellation is ignored", async () => {
  const startedAt = Date.now();
  const result = await settleWithCooperativeTimeout(new Promise<void>(() => {}), {
    timeoutMs: 1,
    settleGraceMs: 5,
    onTimeout: () => {}
  });
  assert.deepEqual(result, { status: "timeout" });
  assert.ok(Date.now() - startedAt < 100);
});

test("cooperative timeout contains a synchronous cancellation-hook failure", async () => {
  const result = await settleWithCooperativeTimeout(new Promise<void>(() => {}), {
    timeoutMs: 1,
    settleGraceMs: 1,
    onTimeout: () => {
      throw new Error("abort hook failed");
    }
  });

  assert.deepEqual(result, { status: "timeout" });
});

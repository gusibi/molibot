import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicSessionId,
  createRuntimeSessionId,
  isTaskSessionId
} from "$lib/server/agent/session/ids.js";

const DATE = new Date(2026, 5, 23, 12, 0, 0);

test("shared runtime ids use one readable Session and Task rule", () => {
  assert.match(createRuntimeSessionId("session", { date: DATE }), /^s-20260623-[a-z]{4}$/);
  assert.match(createRuntimeSessionId("task", { date: DATE }), /^t-20260623-[a-z]{4}$/);
});

test("fork ids are retry-stable and use the Session format", () => {
  const first = createDeterministicSessionId(["source", "message", "request"], DATE);
  const repeated = createDeterministicSessionId(["source", "message", "request"], DATE);
  assert.equal(repeated, first);
  assert.match(first, /^s-20260623-[a-z]{4}$/);
});

test("task detection keeps persisted legacy contexts compatible", () => {
  assert.equal(isTaskSessionId("t-20260623-abcd"), true);
  assert.equal(isTaskSessionId("t-archive-0123456789abcdef"), true);
  assert.equal(isTaskSessionId("task-20260623-abcd"), true);
  assert.equal(isTaskSessionId("s-20260623-abcd"), false);
});

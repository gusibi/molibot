import assert from "node:assert/strict";
import test from "node:test";
import { nextCronOccurrence } from "./events.js";

/**
 * The watcher matches cron fields against process-local time, so the Handover's
 * "next" line must use the same matcher. These cases pin local wall-clock
 * inputs (no UTC conversion) to that behaviour.
 */
test("nextCronOccurrence finds the next local minute for a daily schedule", () => {
  const from = new Date(2026, 9, 23, 7, 30, 0);
  const at = nextCronOccurrence("0 8 * * *", from);
  assert.ok(at);
  const next = new Date(at);
  assert.equal(next.getHours(), 8);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(), 23);
});

test("nextCronOccurrence steps within the same hour and never returns the current minute", () => {
  const from = new Date(2026, 9, 23, 7, 31, 0);
  const at = nextCronOccurrence("*/15 * * * *", from);
  assert.ok(at);
  const next = new Date(at);
  assert.equal(next.getHours(), 7);
  assert.equal(next.getMinutes(), 45);
});

test("nextCronOccurrence rejects malformed schedules instead of guessing", () => {
  assert.equal(nextCronOccurrence("not a cron", new Date()), undefined);
  assert.equal(nextCronOccurrence("0 0 * *", new Date()), undefined);
});

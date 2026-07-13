import assert from "node:assert/strict";
import test from "node:test";
import { finalizeTranscriptActivities } from "./transcript";

test("persisted running activities become terminal without mutating the source", () => {
  const source = [
    { key: "done", kind: "tool" as const, label: "Read", state: "success" as const },
    { key: "stuck", kind: "tool" as const, label: "Search", state: "running" as const }
  ];

  const finalized = finalizeTranscriptActivities(source);

  assert.deepEqual(finalized, [
    { key: "done", kind: "tool", label: "Read", state: "success" },
    { key: "stuck", kind: "tool", label: "Search", state: "error" }
  ]);
  assert.equal(source[1].state, "running");
});

test("terminal activity lists are returned unchanged", () => {
  const source = [{ key: "failed", kind: "tool" as const, label: "Bash", state: "error" as const }];
  assert.equal(finalizeTranscriptActivities(source), source);
});

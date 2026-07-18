import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTranscriptSearchIndex,
  finalizeTranscriptActivities,
  findTranscriptMatches
} from "./transcript";

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

test("transcript search follows rendered content and returns navigable ids in order", () => {
  const messages = [
    { id: "m1", role: "user", content: "Let's deploy the API" },
    { id: "m2", role: "assistant", content: "no relevant text" },
    { id: "m3", role: "assistant", content: "API rate limits" },
    { id: "attachment", role: "user", content: "(attachment)", attachments: [{ original: "report.pdf", mediaType: "file" as const }] },
    { id: "error", role: "assistant", content: "Sorry, something went wrong." },
    { role: "assistant", content: "api text without a navigable id" }
  ];

  assert.deepEqual(findTranscriptMatches(messages, "api"), ["m1", "m3"]);
  assert.deepEqual(findTranscriptMatches(messages, "attachment", "本地错误"), []);
  assert.deepEqual(findTranscriptMatches(messages, "本地错误", "本地错误"), ["error"]);
  assert.deepEqual(findTranscriptMatches(messages, ""), []);
});

test("transcript search index stays valid as result counts change", () => {
  assert.equal(clampTranscriptSearchIndex(7, 2), 1);
  assert.equal(clampTranscriptSearchIndex(-3, 2), 0);
  assert.equal(clampTranscriptSearchIndex(1, 0), 0);
});

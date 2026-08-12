import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTranscriptSearchIndex,
  finalizeTranscriptActivities,
  findTranscriptMatches,
  transcriptCompletedTurnSections,
  transcriptProcessSummary
} from "./transcript";

test("completed turns fold every pre-answer reasoning, narration, and tool block into one process", () => {
  const activity = { key: "read", kind: "tool" as const, label: "Read", state: "success" as const, durationMs: 1250 };
  const blocks = [
    { id: "thinking-1", kind: "thinking" as const, content: "Inspect the project" },
    { id: "preamble", kind: "text" as const, content: "I will read the relevant files." },
    { id: "read", kind: "activities" as const, activities: [activity] },
    { id: "answer", kind: "text" as const, content: "Here is the answer." }
  ];

  const sections = transcriptCompletedTurnSections(blocks);
  assert.deepEqual(sections.process, blocks.slice(0, 3));
  assert.deepEqual(sections.response, blocks.slice(3));
  assert.deepEqual(transcriptProcessSummary(sections.process), {
    stepCount: 2,
    durationMs: 1250,
    hasError: false
  });
});

test("plans and plain answers are never hidden inside the completed process disclosure", () => {
  const plan = {
    id: "plan-1",
    title: "Plan",
    summary: "Summary",
    status: "proposed" as const,
    steps: [],
    recommendedMode: "manual" as const,
    artifactPath: "plans/plan-1.md"
  };
  const blocks = [
    { id: "thinking", kind: "thinking" as const, content: "Think" },
    { id: "plan", kind: "plan" as const, plan }
  ];
  assert.deepEqual(transcriptCompletedTurnSections(blocks), { process: [blocks[0]], response: [blocks[1]] });
  assert.deepEqual(transcriptCompletedTurnSections([{ id: "answer", kind: "text", content: "Done" }]), {
    process: [],
    response: [{ id: "answer", kind: "text", content: "Done" }]
  });
});

test("a proposed Plan remains the final visible decision when later process blocks exist", () => {
  const plan = {
    id: "plan-1",
    title: "Plan",
    summary: "Summary",
    status: "proposed" as const,
    steps: [],
    recommendedMode: "manual" as const,
    artifactPath: "plans/plan-1.md"
  };
  const thinking = { id: "thinking", kind: "thinking" as const, content: "Think" };
  const planBlock = { id: "plan", kind: "plan" as const, plan };
  const activity = {
    id: "read",
    kind: "activities" as const,
    activities: [{ key: "read", kind: "tool" as const, label: "Read", state: "success" as const }]
  };
  const answer = { id: "answer", kind: "text" as const, content: "Ready for confirmation." };

  const sections = transcriptCompletedTurnSections([thinking, planBlock, activity, answer]);
  assert.deepEqual(sections.process, [thinking, activity]);
  assert.deepEqual(sections.response, [answer, planBlock]);
});

test("a stale running activity keeps the completed process open as an interruption", () => {
  assert.equal(transcriptProcessSummary([{
    id: "stale",
    kind: "activities",
    activities: [{ key: "stale", kind: "tool", label: "Bash", state: "running" }]
  }]).hasError, true);
});

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

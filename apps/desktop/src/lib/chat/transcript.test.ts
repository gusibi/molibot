import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTranscriptSearchIndex,
  finalizeTranscriptActivities,
  findTranscriptMatches,
  transcriptCompletedTurnSections,
  transcriptProcessSummary,
  transcriptTurnSummary
} from "./transcript";
import { formatCompactTokens, modelShortLabel } from "../presentation";

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
    toolCount: 1,
    fileCount: 0,
    durationMs: 1250,
    hasError: false,
    interrupted: false
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

test("a stale running activity is detected as an interruption", () => {
  assert.equal(transcriptProcessSummary([{
    id: "stale",
    kind: "activities",
    activities: [{ key: "stale", kind: "tool", label: "Bash", state: "running" }]
  }]).interrupted, true);
});

test("a failed exploratory tool call sets hasError on summary but does not mark interrupted", () => {
  const summary = transcriptProcessSummary([{
    id: "probe",
    kind: "activities",
    activities: [
      { key: "read-nonexistent", kind: "tool", label: "Read", state: "error" },
      { key: "find-file", kind: "tool", label: "Find", state: "success" }
    ]
  }]);
  assert.equal(summary.hasError, true);
  assert.equal(summary.interrupted, false);
  assert.equal(summary.toolCount, 2);
});

test("process duration is wall-clock elapsed time, not summed parallel tool time", () => {
  const summary = transcriptProcessSummary([{
    id: "parallel",
    kind: "activities",
    activities: [
      { key: "a", kind: "tool", label: "A", state: "success", startedAt: "2026-08-14T10:00:00.000Z", finishedAt: "2026-08-14T10:00:02.000Z", durationMs: 2_000 },
      { key: "b", kind: "tool", label: "B", state: "success", startedAt: "2026-08-14T10:00:01.000Z", finishedAt: "2026-08-14T10:00:03.000Z", durationMs: 2_000 }
    ]
  }]);
  assert.equal(summary.durationMs, 3_000);
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

test("transcriptTurnSummary calculates total elapsed duration from user sent time to assistant finish time", () => {
  const userMessage = {
    role: "user",
    content: "hello",
    createdAt: "2026-08-19T23:50:00.000Z"
  };
  const assistantMessage = {
    role: "assistant",
    content: "world",
    createdAt: "2026-08-19T23:50:45.500Z",
    activities: [
      { key: "tool-1", kind: "tool" as const, label: "Read", state: "success" as const, durationMs: 1200 }
    ],
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1500
    }
  };

  const summary = transcriptTurnSummary(assistantMessage, userMessage);
  assert.equal(summary.durationMs, 45500);
  assert.equal(summary.toolCount, 1);
  assert.equal(summary.totalTokens, 1500);

  // Fallback when userMessage is absent
  const fallbackSummary = transcriptTurnSummary(assistantMessage);
  assert.equal(fallbackSummary.durationMs, 1200);
});

test("formatCompactTokens formats numbers cleanly as k, m, or raw count", () => {
  assert.equal(formatCompactTokens(0), "0");
  assert.equal(formatCompactTokens(500), "500");
  assert.equal(formatCompactTokens(1000), "1k");
  assert.equal(formatCompactTokens(17000), "17k");
  assert.equal(formatCompactTokens(17400), "17.4k");
  assert.equal(formatCompactTokens(100000), "100k");
  assert.equal(formatCompactTokens(1000000), "1m");
  assert.equal(formatCompactTokens(3632294), "3.6m");
  assert.equal(formatCompactTokens(Number.NaN), "0");
});

test("modelShortLabel strips provider prefix and returns only the model display name", () => {
  assert.equal(modelShortLabel("cli-proxy-api/gemini-3.7-flash-high"), "Gemini 3.7 Flash High");
  assert.equal(modelShortLabel("custom::gemini-3.7-flash-high"), "Gemini 3.7 Flash High");
  assert.equal(modelShortLabel("anthropic/claude-3-5-sonnet"), "Claude 3 5 Sonnet");
  assert.equal(modelShortLabel("gemini-3.7-flash-high"), "Gemini 3.7 Flash High");
});


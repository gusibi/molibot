import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTranscriptSearchIndex,
  finalizeTranscriptActivities,
  findTranscriptMatches,
  transcriptProcessSummary,
  transcriptResultUnrecorded,
  transcriptRenderBlocks,
  transcriptTurnSections
} from "./transcript";
import { formatCompactTokens, modelShortLabel } from "../presentation";

test("committed content without steps renders as an answer, including plain and external messages", () => {
  for (const resultKind of [undefined, "final", "partial", "legacy"] as const) {
    const message = { id: "answer", role: "assistant", content: "The actual answer.", resultKind };
    const sections = transcriptTurnSections(transcriptRenderBlocks(message));
    assert.equal(sections.process.length, 0);
    assert.deepEqual(sections.response.map(block => block.kind === "result" ? block.content : ""), [message.content]);
  }
});

test("committed result content is authoritative while unmarked steps remain inspectable process", () => {
  const message = {
    id: "answer", role: "assistant", content: "Complete answer and follow-up question.", resultKind: "final" as const,
    steps: [
      { id: "progress", kind: "text" as const, content: "Checking the records." },
      { id: "old-result", kind: "result" as const, content: "Saved." }
    ]
  };
  const sections = transcriptTurnSections(transcriptRenderBlocks(message));
  assert.deepEqual(sections.process.map(block => block.kind === "text" ? block.content : ""), ["Checking the records."]);
  assert.deepEqual(sections.response.map(block => block.kind === "result" ? block.content : ""), [message.content]);
  assert.deepEqual(findTranscriptMatches([message], "follow-up"), [message.id]);
  assert.deepEqual(findTranscriptMatches([message], "Checking the records"), []);
});

test("live text is process until a result is explicitly committed", () => {
  const steps = [{ id: "progress", kind: "text" as const, content: "I will check this." }];
  const sections = transcriptTurnSections(transcriptRenderBlocks({ role: "assistant", content: "", steps }));
  assert.deepEqual(sections.response, []);
  assert.equal(sections.process[0].kind, "text");
});

test("narration folds into the one process group; the marked result stays the answer", () => {
  const activity = { key: "read", kind: "tool" as const, label: "Read", state: "success" as const, durationMs: 1250 };
  const blocks = [
    { id: "thinking-1", kind: "thinking" as const, content: "Inspect the project" },
    { id: "narration", kind: "text" as const, content: "I will read the relevant files." },
    { id: "read", kind: "activities" as const, activities: [activity] },
    { id: "answer", kind: "result" as const, content: "Here is the answer." }
  ];

  const sections = transcriptTurnSections(blocks);
  assert.deepEqual(sections.process, [blocks[0], blocks[1], blocks[2]]);
  assert.deepEqual(sections.response, [blocks[3]]);
  assert.deepEqual(transcriptProcessSummary(sections.process), {
    toolCount: 1,
    fileCount: 0,
    durationMs: 1250,
    hasError: false,
    interrupted: false
  });
});

test("thinking, narration and tool blocks share one process section; plain answers stand alone", () => {
  const plan = {
    id: "plan-1",
    title: "Plan",
    summary: "Summary",
    status: "accepted" as const,
    steps: [],
    recommendedMode: "manual" as const,
    artifactPath: "plans/plan-1.md"
  };
  const blocks = [
    { id: "thinking", kind: "thinking" as const, content: "Think" },
    { id: "narration", kind: "text" as const, content: "Looking into it." },
    { id: "tools", kind: "activities" as const, activities: [{ key: "read", kind: "tool" as const, label: "Read", state: "success" as const }] },
    { id: "plan", kind: "plan" as const, plan },
    { id: "answer", kind: "result" as const, content: "Done" }
  ];
  assert.deepEqual(transcriptTurnSections(blocks), {
    process: [blocks[0], blocks[1], blocks[2]],
    response: [blocks[3], blocks[4]]
  });
  assert.deepEqual(transcriptTurnSections([{ id: "answer", kind: "result", content: "Done" }]), {
    process: [],
    response: [{ id: "answer", kind: "result", content: "Done" }]
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
  const answer = { id: "answer", kind: "result" as const, content: "Ready for confirmation." };

  const sections = transcriptTurnSections([thinking, planBlock, activity, answer]);
  assert.deepEqual(sections.process, [thinking, activity]);
  assert.deepEqual(sections.response, [answer, planBlock]);
});

test("a trailing tool after the answer never splits the prose", () => {
  // The common assistant shape: full answer, quiet memory write, short final
  // delivery. Tools and narration join the one process group; only the marked
  // deliverable renders in the answer area.
  const tool = (key: string) => ({ id: key, kind: "activities" as const, activities: [{ key, kind: "tool" as const, label: key, state: "success" as const }] });
  const sections = transcriptTurnSections([
    { id: "thinking", kind: "thinking" as const, content: "想一下" },
    { id: "narration", kind: "text" as const, content: "先给完整回答。" },
    tool("save_memory"),
    { id: "final", kind: "result" as const, content: "配置已改好。要顺便打开热重载吗？" }
  ]);
  assert.deepEqual(sections.process.map(block => block.id), ["thinking", "narration", "save_memory"]);
  assert.deepEqual(sections.response.map(block => block.kind === "result" ? block.content : ""), ["配置已改好。要顺便打开热重载吗？"]);
});

test("the unrecorded-result notice applies only to legacy turns that actually ran a process", () => {
  const activity = { id: "a", kind: "activities" as const, activities: [{ key: "read", kind: "tool" as const, label: "Read", state: "success" as const }] };
  const narration = { id: "n", kind: "text" as const, content: "narration" };
  const legacyWithProcess = transcriptTurnSections([activity, narration]);
  assert.equal(transcriptResultUnrecorded({ role: "assistant", content: "tail" }, legacyWithProcess.process), true);
  assert.equal(transcriptResultUnrecorded({ role: "assistant", content: "tail", resultKind: "legacy" }, legacyWithProcess.process), true);
  assert.equal(transcriptResultUnrecorded({ role: "assistant", content: "tail", resultKind: "final" }, legacyWithProcess.process), false);
  assert.equal(transcriptResultUnrecorded({ role: "assistant", content: "tail", resultKind: "partial" }, legacyWithProcess.process), false);
  // A turn with no process could not have lost anything in front of its tail.
  assert.equal(transcriptResultUnrecorded({ role: "assistant", content: "tail" }, []), false);
  assert.equal(transcriptResultUnrecorded({ role: "user", content: "hi" }, legacyWithProcess.process), false);
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

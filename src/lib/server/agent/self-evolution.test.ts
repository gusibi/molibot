import test from "node:test";
import assert from "node:assert/strict";
import { assessMemoryWrite } from "../memory/classifier.js";
import { parseMemoryGovernanceLine } from "../memory/governanceLog.js";
import { parseRunHistoryLine, parseSkillDraftItem } from "./reviewData.js";
import {
  areSkillDraftsSimilar,
  buildSkillDraftMarkdown,
  mergeSkillDraftMarkdown,
  prepareDraftForPromotion,
  shouldSuggestSkillDraft
} from "./skillDraft.js";
import { buildRunReflection, formatRunClosingNote } from "./runSummary.js";

test("suggests skill draft for successful complex runs", () => {
  assert.equal(
    shouldSuggestSkillDraft({
      stopReason: "stop",
      finalText: "done",
      toolCalls: 4,
      toolFailures: 0,
      modelAttempts: 1,
      explicitSkillCount: 0
    }),
    true
  );

  assert.equal(
    shouldSuggestSkillDraft({
      stopReason: "stop",
      finalText: "done",
      toolCalls: 2,
      toolFailures: 0,
      modelAttempts: 1,
      explicitSkillCount: 1
    }),
    false
  );
});

test("skill draft markdown keeps goal and tool path hints", () => {
  const built = buildSkillDraftMarkdown({
    workspaceDir: "/tmp/workspace",
    chatId: "chat-1",
    userMessage: "帮我查一下今天的新闻并整理成摘要",
    finalAnswer: "这里是整理后的摘要",
    toolNames: ["web_search", "write"],
    failedToolNames: ["web_search"],
    explicitSkillNames: [],
    modelFailures: ["primary model timeout"]
  });

  assert.match(built.content, /name:/);
  assert.match(built.content, /web_search, write/);
  assert.match(built.content, /primary model timeout/);
  assert.match(built.content, /这里是整理后的摘要/);
});

test("run closing note includes budget and draft path", () => {
  const text = formatRunClosingNote({
    runId: "run-1",
    stopReason: "stop",
    durationMs: 3200,
    finalText: "done",
    toolNames: ["read", "write", "write"],
    failedToolNames: ["bash"],
    explicitSkillNames: [],
    usedFallbackModel: true,
    modelFailureSummaries: ["primary timeout"],
    budget: {
      toolCalls: 3,
      toolFailures: 1,
      modelAttempts: 2
    },
    budgetLimits: {
      maxToolCalls: 24,
      maxToolFailures: 6,
      maxModelAttempts: 6
    },
    memorySnapshot: {
      createdAt: "2026-04-11T00:00:00.000Z",
      fingerprint: "abc",
      query: "today news",
      selectedCount: 3,
      longTermCount: 2,
      dailyCount: 1
    },
    reflection: {
      outcome: "partial",
      summary: "Run finished, but only after fallback or recoverable failures.",
      nextAction: "Review the saved workflow draft and keep the reusable parts."
    },
    skillDraft: {
      filePath: "/tmp/workspace/skill-drafts/test.md",
      fileName: "test.md",
      name: "test",
      content: "draft"
    }
  });

  assert.equal(text, "Saved a reusable draft: /tmp/workspace/skill-drafts/test.md");
});

test("run closing note stays empty-facing unless a draft was saved", () => {
  const text = formatRunClosingNote({
    runId: "run-2",
    stopReason: "stop",
    durationMs: 21000,
    finalText: "done",
    toolNames: ["memory"],
    failedToolNames: [],
    explicitSkillNames: [],
    usedFallbackModel: false,
    modelFailureSummaries: [],
    budget: {
      toolCalls: 1,
      toolFailures: 0,
      modelAttempts: 1
    },
    budgetLimits: {
      maxToolCalls: 24,
      maxToolFailures: 6,
      maxModelAttempts: 6
    },
    memorySnapshot: {
      createdAt: "2026-04-11T00:00:00.000Z",
      fingerprint: "def",
      query: "chat",
      selectedCount: 13,
      longTermCount: 11,
      dailyCount: 2
    },
    reflection: {
      outcome: "success",
      summary: "Run completed on the primary path.",
      nextAction: "No immediate follow-up needed unless you want to formalize this workflow as a skill."
    }
  });

  assert.match(text, /Run summary/);
  assert.match(text, /Memory snapshot: 13 items/);
});

test("run reflection distinguishes failed and successful outcomes", () => {
  const failed = buildRunReflection({
    stopReason: "error",
    finalText: "",
    failedToolNames: ["web_search"],
    usedFallbackModel: false,
    errorMessage: "timeout",
    skillDraftSaved: false
  });
  assert.equal(failed.outcome, "failed");
  assert.match(failed.nextAction, /web_search/);

  const success = buildRunReflection({
    stopReason: "stop",
    finalText: "done",
    failedToolNames: [],
    usedFallbackModel: false,
    skillDraftSaved: false
  });
  assert.equal(success.outcome, "success");
});

test("memory governance rejects reminders and transient execution logs", () => {
  const reminder = assessMemoryWrite({ content: "提醒我明天上午九点开会" });
  assert.equal(reminder.allowed, false);
  assert.match(reminder.reason ?? "", /提醒/);

  const transient = assessMemoryWrite({ content: "Run summary: tool failures 2, model fallback 1" });
  assert.equal(transient.allowed, false);
  assert.match(transient.reason ?? "", /临时过程信息/);

  const durable = assessMemoryWrite({ content: "以后回复我时请直接给结论，不要先寒暄。" });
  assert.equal(durable.allowed, true);
  assert.equal(durable.prepared?.layer, "long_term");
});

test("draft promotion strips draft markers and infers a stable skill name", () => {
  const draftPath = "/workspace/skill-drafts/2026-04-11-sample.md";
  const draftContent = [
    "---",
    "name: sample",
    "description: sample draft",
    "draft: true",
    "source: auto-run-summary",
    "---",
    "",
    "# Goal",
    "- test"
  ].join("\n");

  const prepared = prepareDraftForPromotion({
    draftPath,
    content: draftContent
  });

  assert.equal(prepared.name, "sample");
  assert.doesNotMatch(prepared.content, /draft:\s*true/);
  assert.doesNotMatch(prepared.content, /source:\s*auto-run-summary/);
  assert.match(prepared.content, /# Goal/);
  assert.match(prepared.content, /sample draft/);
});

test("run history parser keeps summary fields needed by review pages", () => {
  const parsed = parseRunHistoryLine(
    JSON.stringify({
      runId: "run-1",
      createdAt: "2026-04-11T10:00:00.000Z",
      stopReason: "stop",
      durationMs: 2500,
      finalText: "done",
      toolNames: ["read", "write", "write"],
      failedToolNames: [],
      explicitSkillNames: [],
      usedFallbackModel: false,
      modelFailureSummaries: [],
      budget: { toolCalls: 2, toolFailures: 0, modelAttempts: 1 },
      budgetLimits: { maxToolCalls: 24, maxToolFailures: 6, maxModelAttempts: 6 },
      reflection: { outcome: "success", summary: "ok", nextAction: "none" },
      memorySnapshot: { selectedCount: 2, longTermCount: 1, dailyCount: 1 }
    })
  ) as any;

  assert.equal(parsed.runId, "run-1");
  assert.equal(parsed.memorySnapshot.selectedCount, 2);
  assert.deepEqual(parsed.toolNames, ["read", "write", "write"]);
});

test("skill draft parser exposes review metadata", () => {
  const parsed = parseSkillDraftItem({
    filePath: "/workspace/skill-drafts/2026-04-11-sample.md",
    fileName: "2026-04-11-sample.md",
    botId: "bot-a",
    chatId: "chat-1",
    workspaceDir: "/workspace",
    updatedAt: "2026-04-11T10:00:00.000Z",
    content: [
      "---",
      "name: sample",
      "description: sample draft",
      "draft: true",
      "source: auto-run-summary",
      "---",
      "",
      "# Goal",
      "- test"
    ].join("\n")
  });

  assert.equal(parsed.botId, "bot-a");
  assert.equal(parsed.chatId, "chat-1");
  assert.equal(parsed.name, "sample");
  assert.equal(parsed.draft, true);
  assert.match(parsed.content, /# Goal/);
});

test("similar skill drafts are detected and merged without losing prior content", () => {
  const existing = [
    "---",
    "name: daily-news-summary",
    "description: Reusable workflow draft for: 帮我整理今天的新闻",
    "aliases: [daily-news-summary]",
    "draft: true",
    "source: auto-run-summary",
    "merge_count: 1",
    "---",
    "",
    "# When To Use",
    "- Use for requests like: 帮我整理今天的新闻",
    "",
    "# Goal",
    "- Deliver the requested result without rebuilding the workflow from scratch.",
    "",
    "# Suggested Steps",
    "1. Collect the latest news.",
    "2. Summarize by topic.",
    "",
    "# Example Outcome",
    "- Final answer snapshot: 这里是第一版摘要"
  ].join("\n");

  const incoming = buildSkillDraftMarkdown({
    workspaceDir: "/tmp/workspace",
    chatId: "chat-1",
    userMessage: "帮我把今天的重要新闻整理成摘要",
    finalAnswer: "这里是第二版摘要",
    toolNames: ["web_search", "write"],
    failedToolNames: [],
    explicitSkillNames: [],
    modelFailures: []
  }).content;

  assert.equal(
    areSkillDraftsSimilar({
      candidateName: "daily-news-summary",
      candidateDescription: "Reusable workflow draft for: 帮我把今天的重要新闻整理成摘要",
      candidateMessage: "帮我把今天的重要新闻整理成摘要",
      existingFileName: "2026-04-11-daily-news-summary.md",
      existingContent: existing
    }),
    true
  );

  const merged = mergeSkillDraftMarkdown(existing, incoming);
  assert.match(merged, /merge_count: 2/);
  assert.match(merged, /这里是第一版摘要/);
  assert.match(merged, /这里是第二版摘要/);
  assert.match(merged, /web_search, write/);
});

test("memory rejection log parser keeps blocked write details", () => {
  const parsed = parseMemoryGovernanceLine(
    JSON.stringify({
      createdAt: "2026-04-11T10:00:00.000Z",
      action: "add",
      channel: "telegram",
      externalUserId: "chat-1",
      reason: "提醒、定时、周期任务不应写进记忆，请改用任务/提醒能力。",
      content: "提醒我明天开会",
      layer: "long_term",
      tags: ["class:general"]
    })
  );

  assert.equal(parsed?.action, "add");
  assert.equal(parsed?.channel, "telegram");
  assert.equal(parsed?.externalUserId, "chat-1");
  assert.match(parsed?.reason ?? "", /提醒/);
  assert.match(parsed?.content ?? "", /明天开会/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { RunHistoryItem } from "$lib/server/agent/session/reviewData";
import {
  buildDesktopRunHistoryCounts,
  buildDesktopRunHistoryItem
} from "./desktopRunHistory";

function fixture(overrides: Partial<RunHistoryItem> = {}): RunHistoryItem {
  return {
    runId: "run-1",
    workspaceId: "ws",
    createdAt: "2026-06-28T00:00:00.000Z",
    botId: "default",
    chatId: "chat-1",
    workspaceDir: "/Users/example/.molibot/moli-t/bots/default/chat-1",
    filePath: "/Users/example/.molibot/moli-t/bots/default/chat-1/run-summaries.jsonl",
    stopReason: "stop",
    durationMs: 12345,
    finalText: "sensitive model output that must not leak",
    toolNames: ["search", "bash"],
    failedToolNames: ["bash"],
    explicitSkillNames: ["draft"],
    usedFallbackModel: true,
    modelFailureSummaries: ["primary-timeout"],
    reflectionOutcome: "partial",
    reflectionSummary: "Completed with one failed tool.",
    nextAction: "Retry the bash step.",
    memorySelectedCount: 3,
    skillDraftPath: "/Users/example/.molibot/skills/draft/SKILL.md",
    ...overrides
  };
}

test("buildDesktopRunHistoryItem drops absolute paths and finalText but keeps timing, tools, and reflection", () => {
  const item = buildDesktopRunHistoryItem(fixture());

  assert.equal(item.runId, "run-1");
  assert.equal(item.botId, "default");
  assert.equal(item.chatId, "chat-1");
  assert.equal(item.stopReason, "stop");
  assert.equal(item.durationMs, 12345);
  assert.deepEqual(item.toolNames, ["search", "bash"]);
  assert.deepEqual(item.failedToolNames, ["bash"]);
  assert.equal(item.reflectionOutcome, "partial");
  assert.equal(item.reflectionSummary, "Completed with one failed tool.");
  assert.equal(item.nextAction, "Retry the bash step.");
  assert.equal(item.memorySelectedCount, 3);
  assert.equal(item.usedFallbackModel, true);

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("must not leak"), false);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes("workspaceDir"), false);
  assert.equal(serialized.includes("filePath"), false);
  assert.equal(serialized.includes("skillDraftPath"), false);
  assert.equal(serialized.includes("modelFailureSummaries"), false);
  assert.equal(serialized.includes("explicitSkillNames"), false);
});

test("buildDesktopRunHistoryItem coerces an unknown outcome to failed", () => {
  const item = buildDesktopRunHistoryItem(fixture({ reflectionOutcome: "weird" as RunHistoryItem["reflectionOutcome"] }));
  assert.equal(item.reflectionOutcome, "failed");
});

test("buildDesktopRunHistoryCounts totals and splits by outcome", () => {
  const items = [
    buildDesktopRunHistoryItem(fixture({ runId: "1", reflectionOutcome: "success" })),
    buildDesktopRunHistoryItem(fixture({ runId: "2", reflectionOutcome: "success" })),
    buildDesktopRunHistoryItem(fixture({ runId: "3", reflectionOutcome: "partial" })),
    buildDesktopRunHistoryItem(fixture({ runId: "4", reflectionOutcome: "failed" }))
  ];
  assert.deepEqual(buildDesktopRunHistoryCounts(items), { total: 4, success: 2, partial: 1, failed: 1 });
  assert.deepEqual(buildDesktopRunHistoryCounts([]), { total: 0, success: 0, partial: 0, failed: 0 });
});

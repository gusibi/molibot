import assert from "node:assert/strict";
import test from "node:test";
import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import {
  computeDesktopTraceTotals,
  resolveDesktopTraceWindow,
  sanitizeDesktopTraceRange
} from "./desktopTrace";

function fact(overrides: Partial<TraceFactRecord> = {}): TraceFactRecord {
  return {
    id: "1",
    factType: "tool_call",
    runId: "run-1",
    factId: "fact-1",
    channel: "web",
    botId: "default",
    chatId: "chat-1",
    sessionId: "session-1",
    name: "search",
    status: "success",
    durationMs: 100,
    totalTokens: 0,
    payload: {},
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...overrides
  };
}

test("sanitizeDesktopTraceRange accepts known ranges and falls back to today", () => {
  assert.equal(sanitizeDesktopTraceRange("yesterday"), "yesterday");
  assert.equal(sanitizeDesktopTraceRange("last30Days"), "last30Days");
  assert.equal(sanitizeDesktopTraceRange("bogus"), "today");
  assert.equal(sanitizeDesktopTraceRange(undefined), "today");
});

test("resolveDesktopTraceWindow returns a 7-day span for last7Days", () => {
  const win = resolveDesktopTraceWindow("last7Days", "UTC");
  const start = new Date(win.startDate + "T00:00:00Z").getTime();
  const end = new Date(win.endDate + "T00:00:00Z").getTime();
  assert.equal((end - start) / 86_400_000, 6);
});

test("computeDesktopTraceTotals counts tools, models, skills, and tokens without leaking previews", () => {
  const facts: TraceFactRecord[] = [
    fact({ factType: "tool_call", name: "search", status: "success", durationMs: 100 }),
    fact({ factType: "tool_call", name: "bash", status: "error", durationMs: 200, errorPreview: "sensitive error", argsPreview: "secret arg", runId: "run-2", factId: "f2", id: "2" }),
    fact({ factType: "tool_call", name: "bash", status: "blocked", blockedBy: "policy", factId: "f3", id: "3" }),
    fact({ factType: "model_call", provider: "private", model: "private-model", api: "chat", status: "success", durationMs: 500, totalTokens: 1200, inputTokens: 1000, outputTokens: 200, factId: "f4", id: "4" }),
    fact({ factType: "skill_usage", name: "draft", status: "info", payload: { level: "executed" }, factId: "f5", id: "5" }),
    fact({ factType: "skill_usage", name: "draft", status: "info", payload: { level: "loaded" }, factId: "f6", id: "6" })
  ];

  const totals = computeDesktopTraceTotals(facts);
  assert.equal(totals.facts, 6);
  assert.equal(totals.toolCalls, 3);
  assert.equal(totals.executedToolCalls, 2);
  assert.equal(totals.failedTools, 1);
  assert.equal(totals.blockedTools, 1);
  assert.equal(totals.distinctTools, 2);
  assert.equal(totals.modelCalls, 1);
  assert.equal(totals.totalTokens, 1200);
  assert.equal(totals.avgToolDurationMs, 150);
  assert.equal(totals.avgModelDurationMs, 500);
  assert.equal(totals.skillUsages, 2);
  assert.equal(totals.executedSkills, 1);
  assert.equal(totals.distinctSkills, 1);
  assert.equal(totals.bots, 1);
  assert.equal(totals.runs, 2);

  const serialized = JSON.stringify(totals);
  assert.equal(serialized.includes("sensitive error"), false);
  assert.equal(serialized.includes("secret arg"), false);
  assert.equal(serialized.includes("private-model"), false);
  assert.equal(serialized.includes("payload"), false);
});

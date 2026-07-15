import assert from "node:assert/strict";
import test from "node:test";
import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import {
  buildDesktopAgentActivity,
  buildDesktopTraceSummary,
  computeDesktopTraceTotals,
  resolveDesktopTraceWindow,
  sanitizeDesktopTraceQuery,
  sanitizeDesktopTraceRange
} from "./desktopTrace";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import { buildDesktopActiveRuns } from "./desktopActiveRuns";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";

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

test("sanitizeDesktopTraceQuery validates fact type and clamps fetch pagination", () => {
  assert.deepEqual(sanitizeDesktopTraceQuery({ factType: "unknown", sourceLimit: 99, page: -1, pageSize: 999, botId: " bot " }), {
    range: "today",
    factType: "all",
    botId: "bot",
    channel: "",
    chatId: "",
    sessionId: "",
    runId: "",
    sourceLimit: 1000,
    page: 1,
    pageSize: 100
  });
});

test("buildDesktopTraceSummary filters, ranks, paginates, and strips all preview content", () => {
  const today = new Date().toISOString().slice(0, 10);
  const facts = [
    fact({ id: "1", factId: "tool-1", name: "search", channel: "web", botId: "alpha", status: "success", durationMs: 100, argsPreview: "secret argument", resultPreview: "private result", payload: { command: "sensitive" }, createdAt: `${today}T08:00:00.000Z`, updatedAt: `${today}T08:00:00.000Z` }),
    fact({ id: "2", factId: "tool-2", name: "search", channel: "web", botId: "alpha", status: "error", durationMs: 300, errorPreview: "private error", createdAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z` }),
    fact({ id: "3", factId: "model-1", factType: "model_call", provider: "anthropic", model: "claude-a", api: "messages", channel: "web", botId: "alpha", totalTokens: 500, inputTokens: 400, outputTokens: 100, durationMs: 800, createdAt: `${today}T09:10:00.000Z`, updatedAt: `${today}T09:10:00.000Z` }),
    fact({ id: "4", factId: "other", name: "bash", channel: "feishu", botId: "beta", createdAt: `${today}T10:00:00.000Z`, updatedAt: `${today}T10:00:00.000Z` })
  ];
  const summary = buildDesktopTraceSummary("UTC", { range: "today", factType: "all", botId: "alpha", page: 1, pageSize: 10 }, facts);

  assert.equal(summary.totals.facts, 3);
  assert.equal(summary.rankings.tools[0]?.calls, 2);
  assert.equal(summary.rankings.models[0]?.model, "claude-a");
  assert.equal(summary.rankings.bots[0]?.label, "alpha");
  assert.equal(summary.facts.total, 3);
  assert.equal(summary.facts.items[0]?.factType, "model_call");
  assert.deepEqual(summary.options.bots, ["alpha", "beta"]);

  const serialized = JSON.stringify(summary);
  for (const forbidden of ["secret argument", "private result", "private error", "sensitive", "argsPreview", "resultPreview", "errorPreview", '"payload"', "blockedBy"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("buildDesktopAgentActivity maps Bot run facts to Agents and expires terminal states", () => {
  const settings = {
    channels: {
      feishu: { instances: [{ id: "smart-momo", name: "Smart Momo", enabled: true, agentId: "agent-smart" }] }
    }
  } as RuntimeSettings;
  const now = Date.parse("2026-07-12T12:00:20.000Z");
  const items = buildDesktopAgentActivity(settings, [
    fact({ id: "active", factType: "run", factId: "run-active", runId: "run-active", channel: "feishu", botId: "smart-momo", status: "started", startedAt: "2026-07-12T12:00:00.000Z", updatedAt: "2026-07-12T12:00:00.000Z", payload: { taskPreview: "分析这个项目" } }),
    fact({ id: "old", factType: "run", factId: "run-old", runId: "run-old", channel: "feishu", botId: "smart-momo", status: "success", finishedAt: "2026-07-12T11:59:00.000Z", updatedAt: "2026-07-12T11:59:00.000Z" })
  ], now);
  assert.deepEqual(items.map((item) => [item.agentId, item.status, item.channel]), [["agent-smart", "working", "feishu"]]);
  assert.equal(items[0]?.botName, "Smart Momo");
  assert.equal(items[0]?.taskPreview, "分析这个项目");
  assert.deepEqual(items[0]?.subagents, []);

  const completed = buildDesktopAgentActivity(settings, [
    fact({ id: "done", factType: "run", factId: "run-done", runId: "run-done", channel: "feishu", botId: "smart-momo", status: "success", startedAt: "2026-07-12T12:00:00.000Z", finishedAt: "2026-07-12T12:00:15.000Z", updatedAt: "2026-07-12T12:00:15.000Z" })
  ], now);
  assert.equal(completed[0]?.status, "completed");
  assert.equal(JSON.stringify(completed).includes("payload"), false);
});

test("buildDesktopAgentActivity assigns unbound Bots to default and nests Subagents under the parent run", () => {
  const settings = {
    channels: { feishu: { instances: [{ id: "general", name: "General", enabled: true }] } }
  } as RuntimeSettings;
  const now = Date.parse("2026-07-12T12:00:05.000Z");
  const items = buildDesktopAgentActivity(settings, [
    fact({ id: "parent", factType: "run", factId: "run-parent", runId: "run-parent", channel: "feishu", botId: "general", status: "started", startedAt: "2026-07-12T12:00:00.000Z", updatedAt: "2026-07-12T12:00:00.000Z" }),
    fact({ id: "sub", factType: "subagent_task", factId: "researcher:1", runId: "run-parent", channel: "feishu", botId: "general", name: "researcher", status: "started", startedAt: "2026-07-12T12:00:02.000Z", updatedAt: "2026-07-12T12:00:02.000Z", payload: { task: "sensitive task" } })
  ], now);
  assert.equal(items[0]?.agentId, "default");
  assert.deepEqual(items[0]?.subagents.map((item) => [item.name, item.status]), [["researcher", "working"]]);
  assert.equal(JSON.stringify(items).includes("sensitive task"), false);
});

test("buildDesktopAgentActivity drops orphaned started runs after the runtime timeout grace", () => {
  const settings = { channels: { web: { instances: [{ id: "runtime", name: "runtime", enabled: true }] } } } as RuntimeSettings;
  const now = Date.parse("2026-07-12T12:30:00.000Z");
  const items = buildDesktopAgentActivity(settings, [
    fact({ id: "orphan", factType: "run", factId: "orphan", runId: "orphan", channel: "web", botId: "runtime", status: "started", startedAt: "2026-07-12T09:21:17.000Z", updatedAt: "2026-07-12T09:21:17.000Z" })
  ], now);
  assert.deepEqual(items, []);
});

test("active run controls distinguish running, stuck, and orphan records", () => {
  const activeSettings = {
    agents: [{ id: "smart", name: "Smart", enabled: true }],
    channels: { feishu: { instances: [{ id: "bot-1", name: "Research Bot", enabled: true, agentId: "smart" }, { id: "global", name: "Global Bot", enabled: true }] } }
  } as RuntimeSettings;
  const activeFacts = [
    fact({ id: "live", factType: "run", runId: "live", factId: "live", channel: "feishu", botId: "bot-1", chatId: "chat", sessionId: "session", status: "started", startedAt: "2026-07-12T12:00:00.000Z", payload: { taskPreview: "Analyze" } }),
    fact({ id: "stuck", factType: "run", runId: "stuck", factId: "stuck", channel: "feishu", botId: "global", chatId: "old-chat", sessionId: "old-session", status: "started", startedAt: "2026-07-12T11:40:00.000Z" }),
    fact({ id: "orphan-active", factType: "run", runId: "orphan-active", factId: "orphan-active", channel: "feishu", botId: "bot-1", chatId: "gone", sessionId: "gone", status: "started", startedAt: "2026-07-12T12:00:00.000Z" })
  ];
  const items = buildDesktopActiveRuns(activeSettings, activeFacts, [
    { channel: "feishu", botId: "bot-1", chatId: "chat", sessionId: "session" },
    { channel: "feishu", botId: "global", chatId: "old-chat", sessionId: "old-session" }
  ], Date.parse("2026-07-12T12:01:00.000Z"));
  assert.equal(items.find((item) => item.runId === "stuck")?.status, "stuck");
  assert.equal(items.find((item) => item.runId === "orphan-active")?.status, "orphan");
  assert.equal(items.find((item) => item.runId === "live")?.status, "running");
  assert.equal(items.find((item) => item.runId === "live")?.agentName, "Smart");
  assert.equal(items.find((item) => item.runId === "stuck")?.agentName, "Global");
});

test("active run controls treat a Web runtime snapshot as live", () => {
  const webFact = fact({
    id: "web-live",
    factType: "run",
    runId: "web-live",
    factId: "web-live",
    channel: "web",
    botId: "default",
    chatId: "web:default:web-anonymous",
    sessionId: "session-web",
    status: "started",
    startedAt: "2026-07-14T12:00:00.000Z"
  });
  const items = buildDesktopActiveRuns({} as RuntimeSettings, [webFact], [{
    channel: "web",
    botId: "default",
    chatId: "web:default:web-anonymous",
    sessionId: "session-web"
  }], Date.parse("2026-07-14T12:01:00.000Z"));
  assert.equal(items[0]?.status, "running");
});

test("clearing an orphan preserves its audit fact but removes it from active runs", () => {
  const store = new SqliteTraceStore(":memory:");
  const started = fact({
    id: "orphan",
    factType: "run",
    runId: "orphan",
    factId: "orphan",
    status: "started",
    startedAt: "2026-07-14T12:00:00.000Z"
  });
  try {
    store.upsertFact(started);
    assert.equal(buildDesktopActiveRuns({} as RuntimeSettings, store.listRecentFacts(), [], Date.parse("2026-07-14T12:01:00.000Z")).length, 1);

    store.upsertFact({
      ...started,
      status: "aborted",
      finishedAt: "2026-07-14T12:01:00.000Z",
      updatedAt: "2026-07-14T12:01:00.000Z",
      payload: { clearedFromTrace: true }
    });

    const facts = store.listFactsByRunId("orphan");
    assert.equal(facts.length, 1);
    assert.equal(facts[0]?.status, "aborted");
    assert.deepEqual(buildDesktopActiveRuns({} as RuntimeSettings, facts, [], Date.parse("2026-07-14T12:01:00.000Z")), []);
  } finally {
    store.close();
  }
});

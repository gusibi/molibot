import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
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

test("model outcomes partition all requests independently of tool failures", () => {
  const today = new Date().toISOString().slice(0, 10);
  const statuses = ["success", "error", "started", "waiting", "aborted", "blocked", "info"] as const;
  const facts = statuses.map((status, i) => fact({ id: String(i), factId: String(i), factType: "model_call", status, model: "model", payload: { agentId: "analyst" }, createdAt: `${today}T08:00:00.000Z` }));
  facts.push(fact({ id: "tool-error", factId: "tool-error", status: "error", createdAt: `${today}T08:00:00.000Z` }));
  const summary = buildDesktopTraceSummary("UTC", { range: "today" }, facts);
  assert.deepEqual(summary.totals.modelOutcomes, { success: 1, error: 1, pending: 2, aborted: 1, blocked: 1, other: 1 });
  assert.equal(Object.values(summary.totals.modelOutcomes).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(summary.rankings.models[0].outcomes, summary.totals.modelOutcomes);
  assert.equal(summary.rankings.agents[0].id, "analyst");
  assert.equal(summary.rankings.agents[0].modelCalls, 7);
  assert.equal(summary.rankings.channels[0].modelCalls, 7);
});

test("model requests aggregate across API protocols with all outcomes retained", () => {
  const today = new Date().toISOString().slice(0, 10);
  const summary = buildDesktopTraceSummary("UTC", { range: "today" }, [
    fact({ factType: "model_call", provider: "local", model: "fixture", api: "messages", createdAt: `${today}T00:00:00Z` }),
    fact({ factType: "model_call", provider: "local", model: "fixture", api: "responses", status: "error", createdAt: `${today}T00:00:00Z` })
  ]);
  assert.equal(summary.rankings.models.length, 1);
  assert.equal(summary.rankings.models[0].requests, 2);
  assert.equal(summary.rankings.models[0].outcomes.success, 1);
  assert.equal(summary.rankings.models[0].outcomes.error, 1);
});

test("trace analytics includes older requests beyond 5000 newer facts and strips previews", () => {
  const store = new SqliteTraceStore(":memory:");
  const today = new Date().toISOString().slice(0, 10);
  try {
    store.upsertFact(fact({ id: "run-agent", factId: "run-1", factType: "run", payload: { agentId: "researcher" }, createdAt: `${today}T00:00:00.000Z` }));
    store.upsertFact(fact({ id: "old-model", factId: "old-model", factType: "model_call", argsPreview: "secret", payload: { secret: "private" }, createdAt: `${today}T00:00:00.000Z` }));
    const db = store.getDatabase();
    db.exec("BEGIN");
    for (let i = 0; i < 5001; i++) store.upsertFact(fact({ id: `tool-${i}`, factId: `tool-${i}`, createdAt: `${today}T01:00:00.000Z` }));
    db.exec("COMMIT");
    const facts = store.listAnalyticsFacts(today, today, "UTC");
    const summary = buildDesktopTraceSummary("UTC", { range: "today" }, facts);
    assert.equal(summary.totals.modelCalls, 1);
    assert.equal(summary.facts.total, 5003);
    assert.equal(facts.find(row => row.id === "old-model")?.payload?.agentId, "researcher");
    assert.equal(JSON.stringify(facts).includes("secret"), false);
    assert.equal(JSON.stringify(facts).includes("private"), false);
  } finally { store.close(); }
});

test("analytics queries respect local midnight and do not attribute missing Agents to Bots", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    for (const [i, createdAt] of ["2026-10-17T15:59:59.999Z", "2026-10-17T16:00:00.000Z", "2026-10-18T15:59:59.999Z", "2026-10-18T16:00:00.000Z"].entries()) {
      store.upsertFact(fact({ id: `boundary-${i}`, factId: `boundary-${i}`, factType: "model_call", createdAt, payload: {} }));
    }
    const facts = store.listAnalyticsFacts("2026-10-18", "2026-10-18", "Asia/Shanghai");
    assert.deepEqual(facts.map(row => row.id).sort(), ["boundary-1", "boundary-2"]);
    assert.ok(facts.every(row => row.payload.agentId === null));
  } finally { store.close(); }
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
  assert.deepEqual(sanitizeDesktopTraceQuery({ factType: "unknown", page: -1, pageSize: 999, botId: " bot " }), {
    range: "today",
    factType: "all",
    botId: "bot",
    channel: "",
    chatId: "",
    sessionId: "",
    runId: "",
    agentId: "",
    modelId: "",
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
    ...defaultRuntimeSettings,
    agents: [...defaultRuntimeSettings.agents, { id: "agent-smart", name: "Smart", description: "", enabled: true }],
    channels: {
      feishu: { instances: [{ id: "smart-momo", name: "Smart Momo", enabled: true, credentials: {}, allowedChatIds: [], agentId: "agent-smart" }] }
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

test("buildDesktopAgentActivity preserves concurrent runs and 24h history without keeping the Agent visually busy", () => {
  const settings = {
    ...defaultRuntimeSettings,
    agents: [...defaultRuntimeSettings.agents, { id: "agent-a", name: "Agent A", description: "", enabled: true }],
    channels: { web: { instances: [{ id: "worker", name: "Worker", enabled: true, credentials: {}, allowedChatIds: [], agentId: "agent-a" }] } }
  } as RuntimeSettings;
  const now = Date.parse("2026-07-12T12:00:20.000Z");
  const items = buildDesktopAgentActivity(settings, [
    fact({ id: "run-a", factType: "run", factId: "run-a", runId: "run-a", channel: "web", botId: "worker", status: "started", startedAt: "2026-07-12T12:00:10.000Z", updatedAt: "2026-07-12T12:00:10.000Z" }),
    fact({ id: "run-b", factType: "run", factId: "run-b", runId: "run-b", channel: "web", botId: "worker", status: "started", startedAt: "2026-07-12T12:00:05.000Z", updatedAt: "2026-07-12T12:00:05.000Z" }),
    fact({ id: "run-old", factType: "run", factId: "run-old", runId: "run-old", channel: "web", botId: "worker", status: "success", startedAt: "2026-07-12T10:00:00.000Z", finishedAt: "2026-07-12T10:02:00.000Z", updatedAt: "2026-07-12T10:02:00.000Z" })
  ], now);
  assert.equal(items[0]?.status, "working");
  assert.deepEqual(items[0]?.runs.map((run) => run.runId), ["run-a", "run-b", "run-old"]);

  const later = buildDesktopAgentActivity(settings, [
    fact({ id: "run-old", factType: "run", factId: "run-old", runId: "run-old", channel: "web", botId: "worker", status: "success", startedAt: "2026-07-12T10:00:00.000Z", finishedAt: "2026-07-12T10:02:00.000Z", updatedAt: "2026-07-12T10:02:00.000Z" })
  ], now);
  assert.equal(later[0]?.status, "idle");
  assert.equal(later[0]?.runId, "");
  assert.equal(later[0]?.runs[0]?.runId, "run-old");
});

test("buildDesktopAgentActivity assigns unbound Bots to default and nests Subagents under the parent run", () => {
  const settings = {
    ...defaultRuntimeSettings,
    channels: { feishu: { instances: [{ id: "general", name: "General", enabled: true, credentials: {}, allowedChatIds: [] }] } }
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
  const settings = {
    ...defaultRuntimeSettings, channels: { web: { instances: [{ id: "runtime", name: "runtime", enabled: true, credentials: {}, allowedChatIds: [] }] } } } as RuntimeSettings;
  const now = Date.parse("2026-07-12T12:30:00.000Z");
  const items = buildDesktopAgentActivity(settings, [
    fact({ id: "orphan", factType: "run", factId: "orphan", runId: "orphan", channel: "web", botId: "runtime", status: "started", startedAt: "2026-07-12T09:21:17.000Z", updatedAt: "2026-07-12T09:21:17.000Z" })
  ], now);
  assert.deepEqual(items, []);
});

test("active run controls distinguish running, stuck, and orphan records", () => {
  const activeSettings = {
    ...defaultRuntimeSettings,
    agents: [{ id: "default", name: "Global", description: "", enabled: true }, { id: "smart", name: "Smart", description: "", enabled: true }],
    channels: { feishu: { instances: [{ id: "bot-1", name: "Research Bot", enabled: true, credentials: {}, allowedChatIds: [], agentId: "smart" }, { id: "global", name: "Global Bot", enabled: true, credentials: {}, allowedChatIds: [] }] } }
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
  const items = buildDesktopActiveRuns({
    ...defaultRuntimeSettings,} as RuntimeSettings, [webFact], [{
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
    assert.equal(buildDesktopActiveRuns({
    ...defaultRuntimeSettings,} as RuntimeSettings, store.listRecentFacts(), [], Date.parse("2026-07-14T12:01:00.000Z")).length, 1);

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
    assert.deepEqual(buildDesktopActiveRuns({
    ...defaultRuntimeSettings,} as RuntimeSettings, facts, [], Date.parse("2026-07-14T12:01:00.000Z")), []);
  } finally {
    store.close();
  }
});


test("Agent activity uses the recorded run owner across start, completion and Bot rebinding", async () => {
  const { DefaultHookManager } = await import("$lib/server/agent/hooks/manager.js");
  const { TraceRecorderHook } = await import("$lib/server/agent/hooks/traceRecorderHook.js");
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const settings = { ...defaultRuntimeSettings, channels: { web: { instances: [{ id: "desktop", name: "Desktop", agentId: "default", enabled: true, credentials: {}, allowedChatIds: [] }] } } } as RuntimeSettings;
  const ctx = { runId: "smart-run", channel: "web", botId: "desktop", agentId: "smart", chatId: "chat", sessionId: "session", actorId: "owner" };
  try {
    for (const [stage, status] of [["run.beforeStart", "working"], ["run.finished", "completed"]] as const) {
      manager.emit(stage, ctx, { status: "success", agentId: "default", taskPreview: "Research" });
      await manager.flush({ timeoutMs: 1000 });
      const items = buildDesktopAgentActivity(settings, store.listRecentFacts(100));
      assert.deepEqual(items.map(item => [item.agentId, item.status]), [["smart", status]]);
      settings.channels.web.instances[0].agentId = "another-agent";
      assert.deepEqual(buildDesktopAgentActivity(settings, store.listRecentFacts(100)).map(item => item.agentId), ["smart"]);
    }
  } finally {
    store.close();
  }
});

test("trace trend zero-fills local days and separates MCP; Agent performance uses run results and known prices", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const at = `${today}T00:30:00+08:00`;
  const facts = [
    fact({ id: "model", factType: "model_call", inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100, payload: { agentId: "a", estimatedCostUsd: 0.02 }, createdAt: at }),
    fact({ id: "unknown-price", factType: "model_call", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "mcp", name: "mcp__fixture__read", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "tool", name: "read", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "run-ok", runId: "ok", factType: "run", status: "success", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "run-error", runId: "error", factType: "run", status: "error", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "run-wait", runId: "waiting", factType: "run", status: "waiting", payload: { agentId: "a" }, createdAt: at }),
    fact({ id: "other", factType: "model_call", payload: { agentId: "b", estimatedCostUsd: 9 }, createdAt: at })
  ];
  const summary = buildDesktopTraceSummary("Asia/Shanghai", { range: "last7Days", agentId: "a" }, facts);
  assert.equal(summary.trend.length, 7);
  assert.equal(summary.trend[0].modelCalls, 0);
  assert.deepEqual(summary.trend.at(-1), { key: today, label: today.slice(5), modelCalls: 2, toolCalls: 1, mcpCalls: 1 });
  assert.equal(summary.totals.mcpCalls, 1);
  assert.equal(summary.totals.estimatedCostUsd, 0.02);
  assert.equal(summary.totals.pricedModelCalls, 1);
  assert.equal(summary.totals.cacheReadTokens, 300);
  assert.deepEqual(summary.totals.runOutcomes, { success: 1, error: 1, pending: 1, aborted: 0, blocked: 0, other: 0 });
  assert.equal(summary.rankings.agents[0].estimatedCostUsd, 0.02);
  const hourly = buildDesktopTraceSummary("Asia/Shanghai", { range: "today", agentId: "a" }, facts);
  assert.equal(hourly.trend.length, 24);
  assert.equal(hourly.trend[0].modelCalls, 2);
  const empty = buildDesktopTraceSummary("UTC", { range: "last30Days", agentId: "missing" }, facts);
  assert.equal(empty.trend.length, 30);
  assert.ok(empty.trend.every(point => point.modelCalls === 0 && point.toolCalls === 0 && point.mcpCalls === 0));
  assert.equal(empty.totals.estimatedCostUsd, null);
});


test("Agent completion deduplicates run snapshots and distinguishes zero-cost from missing estimates", () => {
  const createdAt = new Date().toISOString();
  const summary = buildDesktopTraceSummary("UTC", { range: "today" }, [
    fact({ id: "started", factType: "run", runId: "same", status: "started", createdAt, updatedAt: "2026-10-18T00:00:00Z" }),
    fact({ id: "finished", factType: "run", runId: "same", status: "success", createdAt, updatedAt: "2026-10-18T01:00:00Z" }),
    fact({ id: "cancelled", factType: "run", runId: "cancelled", status: "aborted", createdAt }),
    fact({ id: "blocked", factType: "run", runId: "blocked", status: "blocked", createdAt }),
    fact({ id: "free", factType: "model_call", payload: { estimatedCostUsd: 0 }, createdAt }),
    fact({ id: "missing", factType: "model_call", payload: {}, createdAt })
  ]);
  assert.deepEqual(summary.totals.runOutcomes, { success: 1, error: 0, pending: 0, aborted: 1, blocked: 1, other: 0 });
  assert.equal(summary.totals.estimatedCostUsd, 0);
  assert.equal(summary.totals.pricedModelCalls, 1);
});

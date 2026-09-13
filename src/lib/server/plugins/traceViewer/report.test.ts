import assert from "node:assert/strict";
import test from "node:test";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { queryTraceReport } from "./report.js";

test("a scoped report counts unique model calls and measures parallel work by wall time", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const context = { runId: "r1", channel: "web", botId: "bot", chatId: "chat", sessionId: "session" };
    const emit = (stage: any, seconds: number, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date(100000 + seconds * 1000).toISOString(), payload } as any);
    emit("run.beforeStart", 0, { messageId: "user-1" });
    emit("model.call.before", 0, { modelAttemptId: "m1", provider: "p", model: "A" });
    emit("model.call.after", 3, { modelAttemptId: "m1", usage: { input: 100, output: 20, totalTokens: 120 } });
    emit("tool.call.before", 3, { toolCallId: "t1", toolName: "search", parentFactId: "model_call:m1" });
    emit("tool.call.before", 3, { toolCallId: "t2", toolName: "read", parentFactId: "model_call:m1" });
    emit("tool.call.after", 5, { toolCallId: "t2", toolName: "read" });
    emit("tool.call.after", 7, { toolCallId: "t1", toolName: "search" });
    emit("run.finished", 7, { status: "success" });
    const report = queryTraceReport(store, { runId: "r1" }, context);
    assert.equal(report.durationMs, 7000);
    assert.equal(report.totalTokens, 120);
    assert.equal(report.modelCalls, 1);
    assert.equal(report.toolCalls, 2);
    assert.equal(report.nodes.find(node => node.factId === "t1")?.parentId, "r1:model_call:m1");
    assert.throws(() => queryTraceReport(store, { runId: "r1" }, { ...context, sessionId: "other" }), /not found/i);
  } finally { store.close(); }
});

test("message selection stays on the selected turn after a later run starts", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const scope = { channel: "telegram", botId: "bot", chatId: "chat", sessionId: "session" };
    for (const [index, id] of ["first", "second"].entries()) {
      hook.handle({ stage: "run.beforeStart", context: { ...scope, runId: id }, timestamp: new Date(100000 + index * 10000).toISOString(), payload: { messageId: `message-${id}` } } as any);
    }
    assert.equal(queryTraceReport(store, { messageId: "message-first" }, scope).runId, "first");
    assert.equal(queryTraceReport(store, { beforeRunId: "second" }, scope).runId, "first");
    assert.throws(() => queryTraceReport(store, { messageId: "missing" }, scope), /not found/i);
    assert.equal(queryTraceReport(store, { runId: "first" }, scope).totalTokens, null);
  } finally { store.close(); }
});

import { renderTraceReport } from "./render.js";
import { publicTraceReport } from "./report.js";

test("HTML escapes trace content and public snapshots omit previews", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const context = { runId: "safe", channel: "web", chatId: "chat", sessionId: "private-session" };
    hook.handle({ stage: "run.started", context, timestamp: new Date(100000).toISOString(), payload: {} } as any);
    hook.handle({ stage: "tool.call.before", context, timestamp: new Date(101000).toISOString(), payload: { toolCallId: "t", toolName: "<script>alert(1)</script>", argsPreview: "secret command" } } as any);
    const report = queryTraceReport(store, { runId: "safe" }, context);
    const html = renderTraceReport(report, "en");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("secret command"));
    const shared = renderTraceReport(publicTraceReport(report), "en");
    assert.ok(!shared.includes("secret command"));
    assert.ok(!shared.includes("private-session"));
    assert.ok(shared.includes("<details>"));
  } finally { store.close(); }
});

test("public reports drop raw fact IDs and previews while preserving node links", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const context = { runId: "r", channel: "web", chatId: "chat", sessionId: "session" };
    const emit = (stage: any, seconds: number, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date(100000 + seconds * 1000).toISOString(), payload } as any);
    emit("run.started", 0, {});
    emit("model.call.before", 0, { modelAttemptId: "m1", provider: "p", model: "A" });
    emit("model.call.after", 1, { modelAttemptId: "m1", usage: { totalTokens: 10 } });
    emit("tool.call.before", 0, { toolCallId: "call-1", toolName: "search", argsPreview: "secret argument", parentFactId: "model_call:m1" });
    emit("tool.call.after", 1, { toolCallId: "call-1", toolName: "search", resultPreview: "secret result" });
    emit("skill.selected", 0, { name: "demo", scope: "project", filePath: "/Users/private/skills/demo/SKILL.md" });
    emit("run.finished", 1, { status: "success" });
    const trusted = queryTraceReport(store, { runId: "r" }, context);
    assert.equal(trusted.nodes.find(node => node.factType === "skill_usage")?.factId, "/Users/private/skills/demo/SKILL.md");
    const shared = publicTraceReport(trusted);
    const serialized = JSON.stringify(shared);
    assert.ok(!serialized.includes("/Users/private"));
    assert.ok(!serialized.includes("factId"));
    assert.ok(!serialized.includes("call-1"));
    assert.ok(!serialized.includes("secret argument"));
    assert.ok(!serialized.includes("secret result"));
    assert.ok(shared.nodes.every(node => node.id.startsWith("node-")));
    assert.ok(shared.runId.startsWith("trace-"));
    assert.notEqual(shared.runId, trusted.runId);
    const child = shared.nodes.find(node => node.factType === "tool_call");
    const parent = shared.nodes.find(node => node.factType === "model_call");
    assert.equal(child?.parentId, parent?.id);
    assert.equal(child?.name, "search");
  } finally { store.close(); }
});

test("retries keep distinct identities without double counting tokens", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const context = { runId: "r", channel: "web", chatId: "chat", sessionId: "session" };
    const emit = (stage: any, seconds: number, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date(100000 + seconds * 1000).toISOString(), payload } as any);
    emit("run.started", 0, {});
    emit("model.call.before", 0, { modelAttemptId: "m:0:0:1", provider: "p", model: "A", attemptIndex: 0, candidateIndex: 0 });
    emit("model.call.after", 1, { modelAttemptId: "m:0:0:1", provider: "p", model: "A", attemptIndex: 0, candidateIndex: 0, usage: { totalTokens: 100 } });
    emit("model.call.before", 1, { modelAttemptId: "m:0:1:2", provider: "p", model: "A", attemptIndex: 1, candidateIndex: 0 });
    emit("model.call.after", 2, { modelAttemptId: "m:0:1:2", provider: "p", model: "A", attemptIndex: 1, candidateIndex: 0, usage: { totalTokens: 120 } });
    emit("run.finished", 2, { status: "success" });
    const report = queryTraceReport(store, { runId: "r" }, context);
    const models = report.nodes.filter(node => node.factType === "model_call");
    assert.equal(report.modelCalls, 2);
    assert.equal(report.totalTokens, 220);
    assert.equal(new Set(models.map(node => node.id)).size, 2);
    assert.deepEqual(models.map(node => node.attemptIndex), [0, 1]);
  } finally { store.close(); }
});

test("unfinished steps only grow while the run is active", () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const context = { runId: "r", channel: "web", chatId: "chat", sessionId: "session" };
    const emit = (stage: any, seconds: number, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date(100000 + seconds * 1000).toISOString(), payload } as any);
    emit("run.started", 0, {});
    emit("tool.call.before", 0, { toolCallId: "stuck", toolName: "search" });
    const activeHtml = renderTraceReport(queryTraceReport(store, { runId: "r" }, context, new Date(200000)), "en");
    assert.ok(activeHtml.includes("width:100%"));
    emit("run.finished", 1, { status: "success" });
    const terminalHtml = renderTraceReport(queryTraceReport(store, { runId: "r" }, context, new Date(200000)), "en");
    assert.ok(terminalHtml.includes("width:0%"));
    assert.ok(terminalHtml.includes("Not recorded"));
  } finally { store.close(); }
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("parent relationships survive closing and reopening the trace store", () => {
  const root = mkdtempSync(join(tmpdir(), "trace-restart-"));
  const file = join(root, "trace.sqlite");
  let store = new SqliteTraceStore(file);
  try {
    const context = { runId: "r", channel: "web", chatId: "chat", sessionId: "session" };
    const hook = new TraceRecorderHook(store);
    const emit = (stage: any, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date().toISOString(), payload } as any);
    emit("run.started", {});
    emit("subagent.task.before", { agent: "scout", subagentTaskId: "delegation:1", parentFactId: "tool_call:delegate" });
    emit("model.call.before", { modelAttemptId: "child", parentFactId: "subagent_task:delegation:1", model: "B" });
    emit("model.call.after", { modelAttemptId: "child", usage: { totalTokens: 45 } });
    emit("subagent.task.after", { agent: "scout", subagentTaskId: "delegation:1", stopReason: "stop" });
    emit("run.finished", { status: "success" });
    store.close(); store = new SqliteTraceStore(file);
    const report = queryTraceReport(store, { runId: "r" }, context);
    assert.equal(report.nodes.find(n => n.factId === "child")?.parentId, "r:subagent_task:delegation:1");
    assert.equal(report.totalTokens, 45);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

import { createSubagentTool } from "$lib/server/agent/tools/subagent.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

test("repeated delegation to the same agent produces distinct child branches", async () => {
  const store = new SqliteTraceStore(":memory:");
  const root = mkdtempSync(join(tmpdir(), "trace-delegation-"));
  try {
    const context = { runId: "r", channel: "web", chatId: "chat", sessionId: "session" };
    const hook = new TraceRecorderHook(store);
    const onTrace = (stage: any, payload: Record<string, unknown>) => hook.handle({ stage, context, timestamp: new Date().toISOString(), payload } as any);
    onTrace("run.started", {});
    const tool = createSubagentTool({ cwd: root, workspaceDir: root, chatId: "chat", runId: "r", getSettings: () => defaultRuntimeSettings, onTrace,
      runSubagent: async (agent, task, options) => {
        options.onTrace?.("model.call.before", { modelAttemptId: options.subagentTaskId, parentFactId: `subagent_task:${options.subagentTaskId}`, model: "test" });
        options.onTrace?.("model.call.after", { modelAttemptId: options.subagentTaskId, usage: { totalTokens: 25 }, stopReason: "stop" });
        return { agent: agent.name, task, output: "done", stopReason: "stop", usage: { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, total: 25, cost: 0, turns: 1 } };
      }
    });
    await tool.execute("delegate-1", { agent: "scout", task: "inspect" });
    await tool.execute("delegate-2", { agent: "scout", task: "inspect again" });
    const report = queryTraceReport(store, { runId: "r" }, context);
    assert.equal(report.nodes.filter(node => node.factType === "subagent_task").length, 2);
    assert.equal(report.modelCalls, 2);
    assert.equal(report.totalTokens, 50);
    assert.equal(new Set(report.nodes.filter(node => node.factType === "model_call").map(node => node.parentId)).size, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

import { buildTextChannelContext } from "$lib/server/channels/shared/contextBuilder.js";

test("a delivered platform reply resolves to its run without transcript matching", async () => {
  const store = new SqliteTraceStore(":memory:");
  try {
    const hook = new TraceRecorderHook(store);
    const scope = { channel: "telegram", botId: "bot", chatId: "chat", sessionId: "session" };
    const context = { ...scope, runId: "reply-run" };
    const emit = (stage: any, payload: Record<string, unknown>) => hook.handle({ stage, kind: "observe", context, timestamp: new Date().toISOString(), payload });
    emit("run.beforeStart", { messageId: "input-1" });
    const ctx = buildTextChannelContext({
      channel: "telegram", event: { chatId: "chat", chatType: "private", messageId: 1, userId: "user", text: "hi", ts: "1", attachments: [], imageContents: [] },
      workspaceDir: ".", chatDir: ".", store: {} as never, sessions: {} as never,
      instanceId: "bot", activeSessionId: "session", conversationKey: "chat", createBotMessageId: () => 1,
      response: { sendText: async () => ({ messageId: "platform-reply-42" }) }
    });
    ctx.recordDeliveredMessage = messageId => emit("reply.delivered", { messageId });
    await ctx.respond("answer", false);
    assert.equal(queryTraceReport(store, { messageId: "platform-reply-42" }, scope).runId, "reply-run");
  } finally { store.close(); }
});

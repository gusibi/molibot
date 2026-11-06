import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { createServer } from "node:http";
import type { DurableExecution } from "$lib/server/agent/durable/types.js";

const projectRoot = mkdtempSync(join(tmpdir(), "molibot-durable-project-"));
const root = mkdtempSync(join(tmpdir(), "molibot-durable-chat-"));
Object.assign(process.env, {
  DATA_DIR: root, DB_DIR: join(root, "db"), SETTINGS_DB_FILE: join(root, "settings.sqlite"),
  SETTINGS_FILE: join(root, "settings.json"), SESSIONS_DIR: join(root, "sessions"),
  SESSIONS_INDEX_FILE: join(root, "sessions", "index.json"), WEB_WORKSPACE_DIR: join(root, "web"),
  PI_CODING_AGENT_DIR: join(root, "pi"), MOLIBOT_DISABLE_EXTERNAL_CHANNELS: "1"
});
const { getRuntime } = await import("$lib/server/app/runtime.js");
const { storageMigrationStatus, confirmStorageMigration } = await import("$lib/server/sessions/agentStorageLifecycle.js");
if (storageMigrationStatus().needed) await confirmStorageMigration();
const runtime = getRuntime();
const { POST: chat } = await import("./+server.js");
const { POST: stream } = await import("../stream/+server.js");
const { loadConversationMessages } = await import("$lib/server/web/conversationProjection.js");
const { getRuntimeContextForConversation, resolveRunnerChatId } = await import("$lib/server/web/runtimeContext.js");
const { getProjectStore } = await import("$lib/server/projects/store.js");
const { deliverDurableAttempt, updateDurableConversationOutput, updateDurableConversationProgress } = await import("$lib/server/agent/durable/conversation.js");
const project = getProjectStore().create({ name: "Durable chat", rootPath: projectRoot });

for (const projectMode of [false, true]) for (const streaming of [false, true]) {
  test(`${streaming ? "stream" : "chat"} preserves ${projectMode ? "Project" : "ordinary"} one ordinary response after durable admission`, async () => {
    const owner = "web:personal:web-anonymous";
    const conversation = projectMode
      ? runtime.sessions.createProjectConversation(project.id, owner)
      : runtime.sessions.createWebConversation(owner, undefined, "default");
    runtime.sessions.renameConversation(conversation.id, "web", owner, "Durable regression");
    const text = "请在后台分阶段整理需求，等待我的确认后继续。";
    const handler = streaming ? stream : chat;
    const response = await handler({ request: new Request(`http://localhost/api/${streaming ? "stream" : "chat"}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "personal", conversationId: conversation.id, projectId: projectMode ? project.id : undefined, message: text, durableMode: "force" })
    }) } as Parameters<typeof handler>[0]);
    assert.equal(response.status, 200);
    let startPayload: { response: string; durableExecution?: { execution: DurableExecution } } | undefined;
    if (streaming) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!startPayload) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          for (const block of buffer.split("\n\n")) {
            const data = block.split("\n").find(line => line.startsWith("data: "));
            if (!data) continue;
            const item = JSON.parse(data.slice(6));
            if (item.durableExecution) startPayload = item;
          }
          buffer = buffer.includes("\n\n") ? buffer.slice(buffer.lastIndexOf("\n\n") + 2) : buffer;
        }
      } finally {
        await reader.cancel();
      }
    } else startPayload = JSON.parse(await response.text());
    assert.ok(startPayload);
    const payload = startPayload;
    assert.ok(payload.durableExecution);
    const execution = payload.durableExecution.execution;
    assert.ok(payload.durableExecution);
    const reloaded = loadConversationMessages({ profileId: "personal", conversationId: conversation.id });
    assert.equal(reloaded[0]?.content, text);
    assert.equal(reloaded[1]?.role, "assistant");
    assert.equal(payload.response, "");
    assert.equal(reloaded[1]?.content, "");
    assert.equal(reloaded[1]?.stopReason, "running");
    assert.equal(reloaded[1]?.resultKind, "none");
    assert.equal(runtime.sessions.listMessageMetadata(conversation.id).length, 2);
    const { store } = getRuntimeContextForConversation("personal", conversation.id);
    const context = store.loadContext(resolveRunnerChatId(conversation.id, owner), conversation.id);
    assert.equal(context.filter(message => message.role === "user").length, 1);
    assert.doesNotMatch(JSON.stringify(context), /Created durable execution|已创建长任务/);
    if (streaming) {
      updateDurableConversationOutput(runtime.sessions, execution, "result-live", "text", "Live checkpoint");
      await new Promise(resolve => setTimeout(resolve, 250));
      const checkpoint = loadConversationMessages({ profileId: "personal", conversationId: conversation.id });
      assert.equal(checkpoint[1]?.content, "Live checkpoint");
      assert.equal(checkpoint[1]?.stopReason, "running");
    }
    for (const state of ["running", "success"] as const) {
      updateDurableConversationProgress(runtime.sessions, execution, [{ key: "attempt:read", kind: "tool", tool: "read", label: "Read input", state }]);
      const progress = loadConversationMessages({ profileId: "personal", conversationId: conversation.id });
      assert.equal(progress.length, 2);
      assert.equal(progress[1].id, reloaded[1].id);
      assert.equal(progress[1].activities?.find(activity => activity.key === "attempt:read")?.state, state);
    }

    const delivery = { execution, sessionId: conversation.id, runId: `result-${conversation.id}`, text: "结果已经完成，可以继续在这里讨论。" };
    // Interrupt between the Agent append and UI metadata write, then retry delivery.
    const update = runtime.sessions.updateConversationMessage;
    runtime.sessions.updateConversationMessage = () => { throw new Error("delivery interrupted"); };
    try { assert.throws(() => deliverDurableAttempt(runtime.sessions, delivery), /delivery interrupted/); }
    finally { runtime.sessions.updateConversationMessage = update; }
    deliverDurableAttempt(runtime.sessions, delivery);
    deliverDurableAttempt(runtime.sessions, delivery);
    const completed = loadConversationMessages({ profileId: "personal", conversationId: conversation.id });
    assert.deepEqual(completed.map(message => message.content), [text, delivery.text]);
    assert.equal(completed[1].id, reloaded[1].id);
    assert.notEqual(completed[1].stopReason, "running");
    const restoredContext = store.loadContext(owner, conversation.id);
    assert.equal(restoredContext.filter(message => message.role === "assistant").length, 1);
    assert.doesNotMatch(JSON.stringify(restoredContext), /controlled execution attempt/);
  });
}

test("workflow feasibility uses the selected classifier and stays an ordinary conversation", async () => {
  let classifications = 0;
  let receivedQuestion = "";
  const classifier = createServer(async (request, response) => {
    let data = "";
    for await (const chunk of request) data += chunk;
    const body = JSON.parse(data);
    const question = (body.input ?? body).questions.execution_mode;
    receivedQuestion = JSON.stringify(question);
    classifications++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ model: "fixture", answers: { execution_mode: { type: "choice", choice: "ordinary", confidence: 0.99 } } }));
  });
  await new Promise<void>(resolve => classifier.listen(0, "127.0.0.1", resolve));
  const address = classifier.address();
  assert.ok(address && typeof address !== "string");
  const previous = structuredClone(runtime.getSettings().adaptiveThinking);
  runtime.updateSettings({ adaptiveThinking: { ...previous, enabled: true, selectedDecisionModelId: "jev", timeoutMs: 5000,
    decisionModels: [{ id: "jev", provider: "jev", enabled: true, baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "fixture" }] } });
  const owner = "web:personal:web-anonymous";
  const conversation = runtime.sessions.createProjectConversation(project.id, owner);
  runtime.sessions.renameConversation(conversation.id, "web", owner, "Workflow feasibility");
  const { pool } = getRuntimeContextForConversation("personal", conversation.id);
  const runner = pool.get(owner, conversation.id);
  const run = mock.method(runner, "run", async (ctx: Parameters<typeof runner.run>[0]) => {
    await ctx.respond("可行，先讨论方案。无需现在启动后台工作流。");
    return { stopReason: "stop" as const };
  });
  try {
    const response = await chat({ request: new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "personal", conversationId: conversation.id, projectId: project.id,
        message: "我通过 Google Sheet 确认需求，再写 Google Doc 方案并执行，这个流程可行吗？" })
    }) } as Parameters<typeof chat>[0]);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.durableExecution, undefined);
    assert.match(body.response, /先讨论方案/);
    assert.equal(run.mock.callCount(), 1);
    assert.equal(classifications, 1);
    assert.match(receivedQuestion, /feasibility/);
  } finally {
    run.mock.restore();
    runtime.updateSettings({ adaptiveThinking: previous });
    await new Promise<void>((resolve, reject) => classifier.close(error => error ? reject(error) : resolve()));
  }
});

test.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(projectRoot, { recursive: true, force: true }); });

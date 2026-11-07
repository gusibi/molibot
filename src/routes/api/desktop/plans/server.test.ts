import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
const root = mkdtempSync(join(tmpdir(), "molibot-plan-api-"));
Object.assign(process.env, { DATA_DIR: root, DB_DIR: join(root, "db"), SETTINGS_DB_FILE: join(root, "settings.sqlite"), SETTINGS_FILE: join(root, "settings.json"), SESSIONS_DIR: join(root, "sessions"), SESSIONS_INDEX_FILE: join(root, "sessions", "index.json"), WEB_WORKSPACE_DIR: join(root, "web"), PI_CODING_AGENT_DIR: join(root, "pi"), MOLIBOT_DISABLE_EXTERNAL_CHANNELS: "1" });
const { GET, POST } = await import("./+server.js");
const { getRuntime } = await import("$lib/server/app/runtime.js");
const { getDurableExecutionStore } = await import("$lib/server/agent/durable/store.js");
const { getProjectStore } = await import("$lib/server/projects/store.js");
const projectRoots: string[] = [];
const { config } = await import("$lib/server/app/env.js");
const { DurableExecutionRuntime } = await import("$lib/server/agent/durable/runtime.js");
const startWorker = mock.method(DurableExecutionRuntime.prototype, "start");
const reconcileDeliveries = mock.method(DurableExecutionRuntime.prototype, "reconcileAttemptDeliveries");
assert.equal(config.dataDir, root);
const { storageMigrationStatus, confirmStorageMigration } = await import("$lib/server/sessions/agentStorageLifecycle.js");
if (storageMigrationStatus().needed) await confirmStorageMigration();
const runtime = getRuntime();
async function post(body: Record<string, unknown>) {
  const response = await POST({ request: new Request("http://localhost/api/desktop/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) } as Parameters<typeof POST>[0]);
  return { status: response.status, body: await response.json() };
}
async function read(id: string) {
  const url = new URL(`http://localhost/api/desktop/plans?id=${id}`);
  const response = await GET({ url, request: new Request(url) } as Parameters<typeof GET>[0]);
  return response.json();
}

test("plan API bootstrap does not start background execution or delivery reconciliation under node:test", () => {
  assert.equal(startWorker.mock.callCount(), 0);
  assert.equal(reconcileDeliveries.mock.callCount(), 0);
});

test("public plan API saves 31 steps, previews a version, approves once into B Session and rejects stale decisions", async () => {
  const source = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const receiver = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const created = await post({ action: "create", planId: "api-plan", agentId: "default", botId: "default", sourceChannel: "web", sourceChatId: "web:personal:web-anonymous", sourceUiSessionId: source.id, title: "31 steps", tasks: [{ title: "All work", steps: Array.from({ length: 31 }, (_, index) => ({ title: `Step ${index + 1}` })) }] });
  assert.equal(created.status, 200);
  let item = created.body.item;
  assert.equal(item.tasks[0].steps.length, 31);
  assert.equal(item.execution.status, "planned");
  const edited = await post({ action: "edit", executionId: item.execution.id, expectedVersion: item.execution.version, title: "Reviewed plan", summary: "Preserve input", tasks: item.tasks.map((task: any) => ({ ...task, steps: task.steps.map((step: any) => ({ ...step })) })), acceptanceCriteria: [{ description: "Owner verifies all output" }] });
  assert.equal(edited.status, 200);
  item = edited.body.item;
  const body = { action: "approve", planId: item.execution.id, expectedVersion: item.execution.version, sessionId: receiver.id, mode: "manual" };
  const results = await Promise.all([post(body), post({ ...body, sessionId: source.id })]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status !== 200).length, 1);
  const saved = (await read(item.execution.id)).item;
  assert.equal(saved.execution.status, "queued");
  assert.equal(saved.binding.sessionId, receiver.id);
  assert.equal(saved.execution.sourceUiSessionId, source.id);
  assert.equal(saved.tasks[0].steps.length, 31);
  assert.equal(getDurableExecutionStore().pendingWakeups(item.execution.id).length, 1);
  const cancel = await post({ action: "cancel", planId: item.execution.id, expectedVersion: saved.execution.version, actionId: "cancel-api-plan" });
  assert.equal(cancel.body.item.execution.status, "cancelled");
  const removed = await post({ action: "delete", planId: item.execution.id, expectedVersion: cancel.body.item.execution.version });
  assert.equal(removed.body.deleted, true);
  assert.notEqual((await post(body)).status, 200);
});

test("event connection starts with a reload notification and observes committed edits", async () => {
  const controller = new AbortController();
  const url = new URL("http://localhost/api/desktop/plans?stream=true");
  const response = await GET({ url, request: new Request(url, { signal: controller.signal }) } as Parameters<typeof GET>[0]);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /snapshot/);
  const created = await post({ action: "create", planId: "event-plan", botId: "default", title: "Event", tasks: [{ title: "Task", steps: [{ title: "Step" }] }] });
  assert.equal(created.status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /changed/);
  controller.abort(); await reader.cancel();
  assert.equal((await read("event-plan")).item.meta.title, "Event");
});

test("kanban API: create auto-starts, board projects stages, bundle answers requeue", async () => {
  const created = await post({ action: "kanban_create", form: "single", title: "API kanban task", goal: "Ship it", agentId: "default", autoStart: true });
  assert.equal(created.status, 200);
  const executionId = created.body.item.execution.id;
  assert.equal(created.body.item.execution.status, "queued");

  const boardUrl = new URL("http://localhost/api/desktop/plans?view=board");
  const board = await (await GET({ url: boardUrl, request: new Request(boardUrl) } as Parameters<typeof GET>[0])).json();
  assert.equal(board.ok, true);
  assert.ok(board.counts.doing >= 1, "auto-started task sits in Doing");
  assert.ok(board.items.some((item: any) => item.executionId === executionId && item.kind === "kanban"));

  const bundleUrl = new URL(`http://localhost/api/desktop/plans?kanban=true&id=${executionId}`);
  const bundle = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  assert.equal(bundle.ok, true);
  assert.equal(bundle.task.form, "single");
  assert.deepEqual(bundle.receipts, []);
  assert.deepEqual(bundle.inputs, []);

  const answered = await post({ action: "kanban_answer", planId: executionId, text: "先做第一部分" });
  assert.equal(answered.status, 200);
  const detail = await read(executionId);
  assert.equal(detail.item.execution.status, "queued", "an answer on a queued task records input without a transition");
  const bundleAfter = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  assert.deepEqual(bundleAfter.inputs.map((input: any) => input.text), ["先做第一部分"]);
});

test("kanban API binds the task to a visible conversation seeded with the brief", async () => {
  const created = await post({
    action: "kanban_create", form: "single", title: "可见会话任务", goal: "产出本周数据周报",
    agentId: "default", autoStart: false, completionConditions: [{ description: "周报定稿并附数据来源" }]
  });
  assert.equal(created.status, 200);
  const sessionId = created.body.item.execution.sourceUiSessionId;
  assert.ok(sessionId, "the task binds a visible session");
  const conversation = runtime.sessions.getConversationById(sessionId, "web", "web:desktop:kanban");
  assert.ok(conversation, "the bound conversation exists under the task owner");
  assert.equal(conversation.origin, "kanban", "the session carries the task tag marker");
  assert.equal(conversation.title, "可见会话任务");
  assert.equal(conversation.agentId, "default");
  const messages = runtime.sessions.listMessages(sessionId);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /\[看板任务\] 可见会话任务/);
  assert.match(messages[0].content, /产出本周数据周报/);
  assert.match(messages[0].content, /周报定稿并附数据来源/);

  // With a Project the conversation lives in the Project's session list.
  const projectRoot = mkdtempSync(join(tmpdir(), "molibot-plan-api-project-"));
  projectRoots.push(projectRoot);
  const project = getProjectStore().create({ name: "kanban-visible", rootPath: projectRoot });
  const withProject = await post({
    action: "kanban_create", form: "single", title: "项目任务", goal: "在项目里执行",
    agentId: "default", projectId: project.id, autoStart: false
  });
  assert.equal(withProject.status, 200);
  const projectSessionId = withProject.body.item.execution.sourceUiSessionId;
  assert.ok(projectSessionId);
  const projectConversation = runtime.sessions.listProjectConversations(project.id).find(item => item.id === projectSessionId);
  assert.ok(projectConversation, "the task session appears in the Project's session list");
  assert.equal(projectConversation.origin, "kanban");
  // Task creation failure must not leave an orphan session behind.
  const failed = await post({ action: "kanban_create", form: "team", title: "坏任务", goal: "g", coordinatorAgentId: "someone-else", members: [{ agentId: "someone", name: "S" }], autoStart: false });
  assert.equal(failed.status, 400);
  assert.equal(runtime.sessions.listConversations("web", "web:desktop:kanban").some(item => item.title === "坏任务"), false, "failed creation cleans up its conversation");
});

test("kanban steer falls back to a pending input when no round is running", async () => {
  const created = await post({
    action: "kanban_create", form: "single", title: "插话任务", goal: "产出周报",
    agentId: "default", autoStart: false
  });
  assert.equal(created.status, 200);
  const executionId = created.body.item.execution.id;
  const sessionId = created.body.item.execution.sourceUiSessionId;
  assert.ok(sessionId);

  const steered = await post({ action: "kanban_steer", planId: executionId, text: "优先用现有数据，不要重新爬取" });
  assert.equal(steered.status, 200);
  assert.equal(steered.body.delivered, false, "no live round: the steer falls back to the input channel");
  const bundleUrl = new URL(`http://localhost/api/desktop/plans?kanban=true&id=${executionId}`);
  const bundle = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  assert.deepEqual(bundle.inputs.map((input: any) => input.text), ["优先用现有数据，不要重新爬取"]);
  const messages = runtime.sessions.listMessages(sessionId);
  assert.ok(messages.length >= 2, "brief and steer both appear in the visible conversation");
  assert.match(messages[messages.length - 1].content, /优先用现有数据/);
});

test("team tasks create read-only member child sessions nested under the main conversation", async () => {
  const created = await post({
    action: "kanban_create", form: "team", title: "团队任务", goal: "多人协作",
    coordinatorAgentId: "default",
    members: [{ agentId: "default", name: "Momo" }, { agentId: "writer", name: "Writer" }],
    autoStart: false
  });
  assert.equal(created.status, 200);
  const executionId = created.body.item.execution.id;
  const mainSessionId = created.body.item.execution.sourceUiSessionId;
  assert.ok(mainSessionId);

  const bundleUrl = new URL(`http://localhost/api/desktop/plans?kanban=true&id=${executionId}`);
  const bundle = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  // The coordinator works in the main conversation; only other members get child sessions.
  assert.deepEqual(bundle.memberSessions.map((entry: any) => entry.agentId), ["writer"]);

  for (const memberSession of bundle.memberSessions as Array<{ agentId: string; sessionId: string }>) {
    const child = runtime.sessions.getConversationById(memberSession.sessionId, "web", "web:desktop:kanban");
    assert.ok(child, "the member child session exists");
    assert.equal(child.origin, "kanban");
    assert.equal(child.parentSessionId, mainSessionId, "the child session nests under the main conversation");
    assert.equal(child.agentId, memberSession.agentId);
    assert.match(child.title, /团队任务 · /);
  }

  // Child sessions never appear flat in session lists (spec 切片③ 二级结构).
  const { buildWebItems } = await import("$lib/server/app/desktopConversations.js");
  const entries = runtime.sessions.listAllWebConversations().filter(item => item.externalUserId === "web:desktop:kanban");
  const items = buildWebItems(entries, { webName: () => ({ name: "Momo", deleted: false }), externalName: () => ({ name: "Momo", deleted: false }) });
  assert.ok(items.some(item => item.sessionId === mainSessionId), "the main task conversation stays listed");
  assert.equal(items.some(item => item.sessionId === (bundle.memberSessions as Array<{ sessionId: string }>)[0].sessionId), false, "child sessions are not flat-listed");
});

test("task conversations route sends to the task: child read-only, main steers", async () => {
  const { POST: streamPost } = await import("../../stream/+server.js");
  const { POST: steerPost } = await import("../../stream/steer/+server.js");
  const created = await post({
    action: "kanban_create", form: "team", title: "发送路由", goal: "插话进任务",
    coordinatorAgentId: "default",
    members: [{ agentId: "default", name: "Momo" }, { agentId: "writer", name: "Writer" }],
    autoStart: false
  });
  assert.equal(created.status, 200);
  const executionId = created.body.item.execution.id;
  const mainSessionId = created.body.item.execution.sourceUiSessionId;
  const bundleUrl = new URL(`http://localhost/api/desktop/plans?kanban=true&id=${executionId}`);
  const bundle = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  const childSessionId = (bundle.memberSessions as Array<{ sessionId: string }>)[0].sessionId;

  // Member child sessions reject sends outright (read-only views).
  const childResponse = await streamPost({ request: new Request("http://localhost/api/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: "default", conversationId: childSessionId, message: "hello" }) }) } as Parameters<typeof streamPost>[0]);
  assert.equal(childResponse.status, 409);
  const childSteer = await steerPost({ request: new Request("http://localhost/api/stream/steer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: "default", conversationId: childSessionId, text: "hello" }) }) } as Parameters<typeof steerPost>[0]);
  assert.equal(childSteer.status, 409);

  // The main task session steers: no round is running, so the text queues as a
  // pending input and lands in the conversation as a user message.
  const mainResponse = await streamPost({ request: new Request("http://localhost/api/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: "default", conversationId: mainSessionId, message: "优先用现有数据" }) }) } as Parameters<typeof streamPost>[0]);
  assert.equal(mainResponse.status, 200);
  const streamText = await mainResponse.text();
  assert.match(streamText, /event: done/);
  assert.match(streamText, /"stopReason":"queued"/);
  const bundleAfter = await (await GET({ url: bundleUrl, request: new Request(bundleUrl) } as Parameters<typeof GET>[0])).json();
  assert.deepEqual(bundleAfter.inputs.map((input: any) => input.text), ["优先用现有数据"]);
  const messages = runtime.sessions.listMessages(mainSessionId);
  assert.match(messages[messages.length - 1].content, /优先用现有数据/);
});

test.after(() => { mock.restoreAll(); rmSync(root, { recursive: true, force: true }); for (const dir of projectRoots) rmSync(dir, { recursive: true, force: true }); });

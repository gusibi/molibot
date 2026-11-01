import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "molibot-handover-api-"));
Object.assign(process.env, {
  DATA_DIR: root,
  DB_DIR: join(root, "db"),
  SETTINGS_DB_FILE: join(root, "settings.sqlite"),
  SETTINGS_FILE: join(root, "settings.json"),
  SESSIONS_DIR: join(root, "sessions"),
  SESSIONS_INDEX_FILE: join(root, "sessions", "index.json"),
  WEB_WORKSPACE_DIR: join(root, "web"),
  PI_CODING_AGENT_DIR: join(root, "pi"),
  MOLIBOT_DISABLE_EXTERNAL_CHANNELS: "1"
});

const { GET } = await import("./+server.js");
const { POST: ACK } = await import("./ack/+server.js");
const { POST: HOST_BASH } = await import("../host-bash/+server.js");
const { PUT: SAVE_NAVIGATION } = await import("../agent-navigation/+server.js");
const { getRuntime } = await import("$lib/server/app/runtime.js");
const { getEventExecutionLeaseStore } = await import("$lib/server/agent/eventsLeaseStore.js");
const { SqliteTraceStore } = await import("$lib/server/agent/hooks/traceStore.js");
const { PlanService } = await import("$lib/server/agent/plans/service.js");
const { storageMigrationStatus, confirmStorageMigration } = await import("$lib/server/sessions/agentStorageLifecycle.js");

if (storageMigrationStatus().needed) await confirmStorageMigration();
const runtime = getRuntime();
test.after(() => rmSync(root, { recursive: true, force: true }));

async function readHandover(): Promise<any> {
  const response = await GET({} as Parameters<typeof GET>[0]);
  assert.equal(response.status, 200);
  return response.json();
}

async function acknowledge(): Promise<any> {
  const response = await ACK({} as Parameters<typeof ACK>[0]);
  assert.equal(response.status, 200);
  return response.json();
}

test("GET /api/desktop/handover returns completed work, live decisions and the previous generation across ack", async () => {
  const session = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  assert.equal(session.agentId, "default");
  const now = new Date();

  const trace = new SqliteTraceStore();
  try {
    trace.upsertFact({
      id: "run-fact-1",
      factType: "run",
      runId: "run-fact-1",
      factId: "run-fact-1",
      channel: "web",
      botId: "default",
      chatId: "chat",
      sessionId: session.id,
      name: session.id,
      status: "success",
      startedAt: new Date(now.getTime() - 60_000).toISOString(),
      finishedAt: now.toISOString(),
      durationMs: 60_000,
      payload: { agentId: "default", taskPreview: "Wrote the weekly summary" },
      createdAt: new Date(now.getTime() - 60_000).toISOString(),
      updatedAt: now.toISOString()
    });
  } finally {
    trace.close();
  }

  const leases = getEventExecutionLeaseStore();
  const lease = leases.acquire({
    eventFile: "task-1.json",
    eventType: "periodic",
    triggerSlot: `manual:${now.getTime()}`,
    chatId: "chat",
    sessionId: session.id,
    channel: "web",
    taskId: "task-1",
    runId: "task-run-1",
    maxAttempts: 1,
    timeoutMs: 60_000,
    eventPayloadJson: JSON.stringify({ text: "Morning briefing" })
  });
  assert.ok(lease);
  leases.markCompleted(lease!.id, "task-run-1", { text: "sent" });

  const requested = runtime.hostBashStore.requestApproval({
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser --open",
    reason: "Requires browser IPC outside the sandbox.",
    approvalMode: "ephemeral",
    channel: "web",
    chatId: "web:personal:web-anonymous",
    scopeId: "web:personal:web-anonymous",
    sessionId: session.id
  });
  assert.equal(requested.kind, "created");

  const first = await readHandover();
  assert.equal(first.ok, true);
  assert.equal(first.handover.state, "active");
  assert.equal(first.handover.items.length, 1, "only the task delivery is a result");
  assert.equal(first.handover.counts.completed, 1);
  assert.equal(first.handover.pending.length, 1);
  assert.equal(first.handover.pending[0].requestId, requested.approval?.id);
  assert.equal(first.handover.pending[0].agentId, "default");
  assert.equal(first.handover.lastAcknowledgedAt, undefined);

  const ack = await acknowledge();
  assert.equal(ack.ok, true);
  assert.ok(Date.parse(ack.lastAcknowledgedAt));

  const second = await readHandover();
  assert.equal(second.handover.items.length, 0);
  assert.equal(second.handover.state, "active", "live decisions are not consumed by the window");
  assert.equal(second.handover.pending.length, 1);
  assert.equal(second.handover.previous?.items.length, 1);
  assert.equal(second.handover.previous?.pendingCount, 1);
  assert.equal("detail" in (second.handover.previous?.items[0] ?? {}), false);

  // A normal navigation save must not erase the window or the previous generation.
  const saved = await SAVE_NAVIGATION({
    request: new Request("http://localhost/api/desktop/agent-navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navigation: { expandedAgentIds: ["default"], page: "session", agentId: "default", sessionId: session.id } })
    })
  } as Parameters<typeof SAVE_NAVIGATION>[0]);
  assert.equal(saved.status, 200);
  const third = await readHandover();
  assert.equal(third.handover.lastAcknowledgedAt, ack.lastAcknowledgedAt);
  assert.equal(third.handover.previous?.items.length, 1);
});

test("resolving a pending approval from the handover clears the source Session state and is idempotent", async () => {
  const session = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const requested = runtime.hostBashStore.requestApproval({
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser --open",
    reason: "Requires browser IPC outside the sandbox.",
    approvalMode: "ephemeral",
    channel: "web",
    chatId: "web:personal:web-anonymous",
    scopeId: "web:personal:web-anonymous",
    sessionId: session.id
  });
  const requestId = requested.approval?.id;
  assert.ok(requestId);
  assert.equal(runtime.hostBashStore.listPending(undefined, session.id).length, 1);

  const before = await readHandover();
  assert.ok(before.handover.pending.some((item: any) => item.requestId === requestId));

  async function resolve(): Promise<any> {
    const response = await HOST_BASH({
      request: new Request("http://localhost/api/desktop/host-bash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_approval", requestId, decision: "reject" })
      })
    } as Parameters<typeof HOST_BASH>[0]);
    return { status: response.status, body: await response.json() };
  }

  const resolved = await resolve();
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.approval?.status, "rejected");
  assert.equal(runtime.hostBashStore.listPending(undefined, session.id).length, 0, "the source Session no longer waits");

  const after = await readHandover();
  assert.equal(after.handover.pending.some((item: any) => item.requestId === requestId), false);

  const repeated = await resolve();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.approval?.status, "not_found");
  assert.equal((await readHandover()).handover.pending.some((item: any) => item.requestId === requestId), false);
});

test("a plan waiting for its first approval is a pending decision with both approval modes", async () => {
  const session = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const plans = new PlanService();
  const plan = plans.create({
    ownerId: "owner",
    botId: "default",
    agentId: "default",
    title: "Review the report",
    summary: "Check the numbers before sending",
    sourceChannel: "web",
    sourceUiSessionId: session.id,
    tasks: [{ title: "Review", steps: [{ title: "Read the report" }] }]
  });

  const handover = await readHandover();
  const item = handover.handover.pending.find((entry: any) => entry.kind === "plan" && entry.planId === plan.execution.id);
  assert.ok(item, "the plan must be listed as waiting on the user");
  assert.deepEqual(item.options, ["manual", "accept_edits"]);
  assert.equal(item.sessionId, session.id);
  assert.equal(item.agentId, "default");
  assert.equal(item.expectedVersion, plan.execution.version);
});

test("a pending approval whose Session was deleted is dropped and expired", async () => {
  const session = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const requested = runtime.hostBashStore.requestApproval({
    toolId: "agent-browser",
    displayName: "Deleted source approval",
    command: "agent-browser --open",
    reason: "Needs browser IPC outside the sandbox.",
    approvalMode: "ephemeral",
    channel: "web",
    chatId: "web:personal:web-anonymous",
    scopeId: "web:personal:web-anonymous",
    sessionId: session.id
  });
  const requestId = requested.approval?.id;
  assert.ok(requestId);
  assert.ok((await readHandover()).handover.pending.some((item: any) => item.requestId === requestId));

  runtime.sessions.deleteConversation(session.id, "web", "web:personal:web-anonymous");

  const after = await readHandover();
  assert.equal(after.handover.pending.some((item: any) => item.requestId === requestId), false, "a deleted source is not a decision");
  assert.equal(runtime.hostBashStore.listPending(undefined, session.id).length, 0, "the orphaned approval is expired, not left pending");
});

test("an in-app chat reply stays out of results while other channels collapse into one aggregate", async () => {
  const webSession = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const now = new Date();
  const trace = new SqliteTraceStore();
  try {
    trace.upsertFact({
      id: "run-web-read",
      factType: "run",
      runId: "run-web-read",
      factId: "run-web-read",
      channel: "web",
      botId: "default",
      chatId: "chat",
      sessionId: webSession.id,
      status: "success",
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      durationMs: 1_000,
      payload: { agentId: "default", taskPreview: "Answered in the app" },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    for (const [id, channel] of [["run-feishu", "feishu"], ["run-weixin", "weixin"]] as const) {
      trace.upsertFact({
        id,
        factType: "run",
        runId: id,
        factId: id,
        channel,
        botId: "default",
        chatId: `chat-${channel}`,
        sessionId: `external-${channel}`,
        status: "success",
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationMs: 1_000,
        payload: { agentId: "default", taskPreview: "Answered on another channel" },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
    }
  } finally {
    trace.close();
  }

  const payload = await readHandover();
  assert.equal(payload.handover.items.length, 0, "an in-app chat reply is a conversation, not a result");
  assert.equal(payload.handover.counts.completed, 0);
  assert.equal(payload.handover.crossChannel?.count, 2);
  assert.deepEqual(payload.handover.crossChannel?.channels, ["feishu", "weixin"]);
});

test("home memory review survives ack and uses real confirmation, edit, ignore and stale-state checks", async () => {
  runtime.updateSettings({ plugins: { ...runtime.settings.plugins, memory: { ...runtime.settings.plugins.memory, enabled: true } } });
  const { POST: MEMORY } = await import("../memory/+server.js");
  const conversation = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const message = runtime.sessions.appendMessage(conversation.id, "user", "Please put the conclusion first in reports.");
  const make = (subject: string) => runtime.memory.createCandidate({
    namespace: "owner:owner", domain: "owner", type: "user_preference", subject,
    path: `mory://user_preference/${subject}`, value: `For ${subject}, present conclusions before supporting evidence.`,
    confidence: 0.9, reason: "Explicit user preference", layer: "long_term",
    sources: [{ channel: "web", sessionId: conversation.id, conversationMessageId: message.id }]
  })!;
  const first = make("home_review_first");
  const second = make("home_review_second");
  assert.ok(first && second);
  await acknowledge();
  const before = await readHandover();
  assert.ok(before.handover.memoryReview.items.some((item: any) => item.id === first.id));
  async function review(body: Record<string, unknown>) {
    return MEMORY({ request: new Request("http://localhost/api/desktop/memory", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }) } as Parameters<typeof MEMORY>[0]);
  }
  const conflict = await review({ action: "confirm-candidate", id: first.id, expectedUpdatedAt: "stale" });
  assert.equal(conflict.status, 409);
  const savedResponse = await review({ action: "confirm-candidate", id: first.id, expectedUpdatedAt: first.updatedAt, content: "Present the conclusion before supporting evidence in reports." });
  assert.equal(savedResponse.status, 200);
  const saved = (await savedResponse.json()).candidate;
  assert.equal(saved.status, "edited-then-confirmed");
  assert.ok(saved.confirmedMemoryId);
  const record = await runtime.memory.getForGovernance({ channel: "web", externalUserId: conversation.id, ownerId: "owner", shareOwner: true }, saved.confirmedMemoryId);
  assert.equal(record?.content, "Present the conclusion before supporting evidence in reports.");
  assert.equal((await review({ action: "confirm-candidate", id: first.id, expectedUpdatedAt: first.updatedAt })).status, 409);
  const ignored = await review({ action: "ignore-candidate", id: second.id, expectedUpdatedAt: second.updatedAt });
  assert.equal((await ignored.json()).candidate.status, "ignored");
  const after = await readHandover();
  assert.ok(!after.handover.memoryReview.items.some((item: any) => item.id === first.id || item.id === second.id));
});

test('home memory comparison reads the original saved record without resolving the candidate', async () => {
  runtime.updateSettings({ plugins: { ...runtime.settings.plugins, memory: { ...runtime.settings.plugins.memory, enabled: true } } });
  const { POST: MEMORY } = await import('../memory/+server.js');
  const conversation = runtime.sessions.createWebConversation('web:personal:web-anonymous', undefined, 'default');
  const source = runtime.sessions.appendMessage(conversation.id, 'user', 'Please replace the introduction preference with conclusions first.');
  const sources = [{ channel: 'web', sessionId: conversation.id, conversationMessageId: source.id }];
  const first = runtime.memory.createCandidate({ namespace: 'owner:owner', domain: 'owner', type: 'user_preference', subject: 'comparison_original', path: 'mory://user_preference/comparison_original', value: 'Prefer detailed introductions.', confidence: 0.9, reason: 'Original preference', layer: 'long_term', sources })!;
  const saved = await runtime.memory.confirmCandidate(first.id);
  assert.ok(saved?.confirmedMemoryId);
  const second = runtime.memory.createCandidate({ namespace: 'owner:owner', domain: 'owner', type: 'user_preference', subject: 'comparison_updated', path: 'mory://user_preference/comparison_updated', value: 'Prefer conclusions before introductions.', confidence: 0.9, reason: 'Updated preference', layer: 'long_term', sources, supersedesMemoryId: saved.confirmedMemoryId })!;
  const call = async (body: Record<string, unknown>) => MEMORY({ request: new Request('http://localhost/api/desktop/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as Parameters<typeof MEMORY>[0]);
  const response = await call({ action: 'compare-candidate', id: second.id, expectedUpdatedAt: second.updatedAt });
  assert.equal(response.status, 200);
  const comparison = (await response.json()).comparison;
  assert.equal(comparison.originals[0].content, 'Prefer detailed introductions.');
  assert.equal(runtime.memory.getCandidate(second.id)?.status, 'pending');
  const stale = await call({ action: 'compare-candidate', id: second.id, expectedUpdatedAt: 'stale' });
  assert.notEqual(stale.status, 200);
  const confirmed = await call({ action: 'confirm-candidate', id: second.id, expectedUpdatedAt: second.updatedAt });
  assert.equal((await confirmed.json()).candidate.status, 'confirmed');
  assert.notEqual((await call({ action: 'compare-candidate', id: second.id, expectedUpdatedAt: second.updatedAt })).status, 200);
});

test('task result API reads the requested execution rather than a later run in the same Session', async () => {
  const { GET: TASKS, POST: TASK_ACTION } = await import('../tasks/+server.js');
  const list = await TASKS({ url: new URL('http://localhost/api/desktop/tasks') } as Parameters<typeof TASKS>[0]);
  const summary = (await list.json()).summary;
  const target = summary.targets.find((item: any) => item.kind === 'channel' && item.channel === 'web');
  assert.ok(target, 'the isolated web target is available');
  const call = async (body: Record<string, unknown>) => TASK_ACTION({ request: new Request('http://localhost/api/desktop/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as Parameters<typeof TASK_ACTION>[0]);
  const createdResponse = await call({ action: 'create', task: { ...target, text: 'Exact execution read', delivery: 'agent', schedule: '0 0 1 1 *', timezone: 'Asia/Shanghai', sessionMode: 'fresh' } });
  assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
  const created = await createdResponse.json();
  const task = created.summary.items.find((item: any) => item.id === created.affected[0]);
  assert.ok(task);
  const session = runtime.sessions.createWebConversation('web:personal:web-anonymous', undefined, 'default');
  const store = getEventExecutionLeaseStore();
  const executions: string[] = [];
  for (const [index, text] of ['Original exact edition', 'Later unrelated edition'].entries()) {
    const now = new Date(Date.now() + index * 1000);
    const runId = `exact-api-run-${index}`;
    const execution = store.acquire({ now, leaseScope: 'agent:default', eventFile: 'exact-reader.json', eventType: 'periodic', triggerSlot: `slot-${index}`, chatId: task.chatId, sessionId: session.id, channel: 'web', taskId: task.taskId, runId, maxAttempts: 1, timeoutMs: 60000, eventPayloadJson: JSON.stringify({ text: task.text }) });
    assert.ok(execution);
    store.markCompleted(execution.id, runId, { text }, now);
    executions.push(execution.id);
  }
  const { MomRuntimeStore } = await import('$lib/server/agent/session/store.js');
  const { agentWorkspaceDir } = await import('$lib/server/sessions/agentStorage.js');
  const { requireBotAgentId } = await import('$lib/server/sessions/executionIdentity.js');
  const workspace = agentWorkspaceDir(root, requireBotAgentId(runtime.getSettings(), task.channel, task.botId));
  new MomRuntimeStore(workspace).saveContext(task.chatId, [{ role: 'assistant', content: [{ type: 'text', text: 'Later untagged Session answer' }], timestamp: Date.now() } as import('@earendil-works/pi-agent-core').AgentMessage], session.id);
  const result = await call({ action: 'session', id: task.id, executionId: executions[0] });
  assert.equal(result.status, 200, await result.clone().text());
  const body = await result.json();
  assert.equal(body.session.messages.at(-1).content, 'Original exact edition');
  assert.equal(JSON.stringify(body.session).includes('Later unrelated edition'), false);
  assert.equal(JSON.stringify(body.session).includes('Later untagged Session answer'), false);
  assert.notEqual((await call({ action: 'session', id: task.id, executionId: 'unknown-execution' })).status, 200);
});

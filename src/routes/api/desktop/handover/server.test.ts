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
  assert.equal(first.handover.items.length, 2);
  assert.equal(first.handover.counts.completed, 2);
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
  assert.equal(second.handover.previous?.items.length, 2);
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
  assert.equal(third.handover.previous?.items.length, 2);
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

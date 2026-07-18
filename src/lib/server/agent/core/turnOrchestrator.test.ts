import assert from "node:assert/strict";
import test from "node:test";
import { TurnOrchestrator, type TurnCleanupStore, type RunningTurnRecord } from "$lib/server/agent/core/turnOrchestrator.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { SqliteApprovalStore } from "$lib/server/approval/approvalStore.js";

function message(input: Partial<ChannelInboundMessage> = {}): ChannelInboundMessage & { runId?: string } {
  return {
    chatId: "chat-1",
    chatType: "private",
    messageId: 42,
    userId: "user-1",
    text: "hello",
    ts: "2026-05-28T00:00:00.000Z",
    attachments: [],
    imageContents: [],
    ...input
  };
}

test("prepareTurn assigns default workspace and stable run metadata", () => {
  const orchestrator = new TurnOrchestrator();
  const inbound = message();
  const sessionId = `session-${Date.now()}-${Math.random()}`;

  const turn = orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: inbound,
    now: Date.now()
  });

  assert.equal(turn.workspaceId, "personal");
  assert.equal(inbound.workspaceId, "personal");
  assert.equal(turn.runId, `chat-1-${sessionId}-42`);
  assert.equal(turn.sessionId, sessionId);
});

test("prepareTurn preserves caller-provided workspace and run id", () => {
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
    VALUES ('team-workspace', 'Team Workspace', datetime('now'), datetime('now'))
  `).run();
  db.close();

  const orchestrator = new TurnOrchestrator();
  const inbound = message({ workspaceId: "Team Workspace" });
  inbound.runId = "run-custom";
  const sessionId = `session-${Date.now()}-${Math.random()}`;

  const turn = orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: inbound
  });

  assert.equal(turn.workspaceId, "team-workspace");
  assert.equal(inbound.workspaceId, "team-workspace");
  assert.equal(turn.runId, "run-custom");
});

test("prepareTurn resumes a run suspended for approval", () => {
  const orchestrator = new TurnOrchestrator();
  const sessionId = `session-resume-${Date.now()}-${Math.random()}`;
  const runId = `run-resume-${Date.now()}-${Math.random()}`;
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'waiting_for_approval', datetime('now'))
  `).run(runId, sessionId);
  db.close();

  const inbound = message({ runId });
  const turn = orchestrator.prepareTurn({ chatId: "chat-1", sessionId, message: inbound });
  assert.equal(turn.runId, runId);

  const verifyDb = new DatabaseSync(storagePaths.settingsDbFile);
  const row = verifyDb.prepare("SELECT status, last_heartbeat FROM runs WHERE id = ?").get(runId) as {
    status: string;
    last_heartbeat: string | null;
  };
  verifyDb.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  verifyDb.close();
  assert.equal(row.status, "running");
  assert.ok(row.last_heartbeat);
});

test("prepareTurn prevents concurrent active turns on same session", () => {
  const orchestrator = new TurnOrchestrator();
  const inbound1 = message({ messageId: 101 });
  const inbound2 = message({ messageId: 102 });
  const sessionId = `session-lock-${Date.now()}-${Math.random()}`;

  // First turn starts running
  orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: inbound1
  });

  // Second turn on same session should throw
  assert.throws(() => {
    orchestrator.prepareTurn({
      chatId: "chat-1",
      sessionId,
      message: inbound2
    });
  }, /Another run is currently active in this session/);
});

test("prepareTurn expires and releases locks older than 10 minutes", () => {
  const orchestrator = new TurnOrchestrator();
  const inbound1 = message({ messageId: 101 });
  const inbound2 = message({ messageId: 102 });
  const sessionId = `session-timeout-${Date.now()}-${Math.random()}`;

  const t1 = Date.now() - 11 * 60 * 1000; // 11 minutes ago
  const t2 = Date.now();

  // First turn starts running in the past
  orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: inbound1,
    now: t1
  });

  // Second turn starts now. It should expire the old lock and succeed.
  const turn2 = orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: inbound2,
    now: t2
  });

  assert.equal(turn2.runId, `chat-1-${sessionId}-102`);
});

test("prepareTurn keeps the lock for a long run with a fresh heartbeat", () => {
  const orchestrator = new TurnOrchestrator();
  const sessionId = `session-hb-fresh-${Date.now()}-${Math.random()}`;
  const runId = `run-hb-fresh-${Date.now()}-${Math.random()}`;

  // Long-running turn: started 30 minutes ago but heartbeating right now.
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at, last_heartbeat)
    VALUES (?, ?, 'user-1', 'web', 'running', ?, ?)
  `).run(
    runId,
    sessionId,
    new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    new Date().toISOString()
  );
  db.close();

  assert.throws(() => {
    orchestrator.prepareTurn({
      chatId: "chat-1",
      sessionId,
      message: message({ messageId: 200 })
    });
  }, /Another run is currently active in this session/);

  orchestrator.abortRunningTurnsForSession(sessionId, "test cleanup");
});

test("prepareTurn releases a lock whose heartbeat went stale", () => {
  const orchestrator = new TurnOrchestrator();
  const sessionId = `session-hb-stale-${Date.now()}-${Math.random()}`;
  const runId = `run-hb-stale-${Date.now()}-${Math.random()}`;

  // Recently started but the owning process died: heartbeat is 3 minutes old.
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at, last_heartbeat)
    VALUES (?, ?, 'user-1', 'web', 'running', ?, ?)
  `).run(
    runId,
    sessionId,
    new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    new Date(Date.now() - 3 * 60 * 1000).toISOString()
  );
  db.close();

  const turn = orchestrator.prepareTurn({
    chatId: "chat-1",
    sessionId,
    message: message({ messageId: 201 })
  });
  assert.equal(turn.runId, `chat-1-${sessionId}-201`);

  const db2 = new DatabaseSync(storagePaths.settingsDbFile);
  const row = db2.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
  db2.close();
  assert.equal(row.status, "failed");

  orchestrator.abortRunningTurnsForSession(sessionId, "test cleanup");
});

test("heartbeatTurn refreshes running rows and ignores settled rows", () => {
  const orchestrator = new TurnOrchestrator();
  const sessionId = `session-hb-touch-${Date.now()}-${Math.random()}`;
  const runningId = `run-hb-touch-${Date.now()}-${Math.random()}`;
  const doneId = `run-hb-done-${Date.now()}-${Math.random()}`;

  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
  `).run(runningId, sessionId);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'completed', datetime('now'))
  `).run(doneId, sessionId);
  db.close();

  assert.equal(orchestrator.heartbeatTurn(runningId), true);
  assert.equal(orchestrator.heartbeatTurn(doneId), false);

  const db2 = new DatabaseSync(storagePaths.settingsDbFile);
  const row = db2.prepare("SELECT last_heartbeat FROM runs WHERE id = ?").get(runningId) as { last_heartbeat: string | null };
  db2.close();
  assert.ok(row.last_heartbeat, "running row should have a refreshed heartbeat");

  orchestrator.abortRunningTurnsForSession(sessionId, "test cleanup");
});

test("cleanupStaleRunningTurns keeps long runs with fresh heartbeats", () => {
  const failed: string[] = [];
  const store: TurnCleanupStore = {
    listRunningTurns: () => [
      // Old start, fresh heartbeat: still alive.
      { id: "long-alive", status: "running", startedAt: "2026-05-28T00:00:00.000Z", lastHeartbeat: "2026-05-28T01:00:00.000Z" },
      // Old start, stale heartbeat: dead.
      { id: "dead", status: "running", startedAt: "2026-05-28T00:00:00.000Z", lastHeartbeat: "2026-05-28T00:30:00.000Z" }
    ],
    markTurnFailed: (id) => {
      failed.push(id);
    }
  };

  const count = new TurnOrchestrator().cleanupStaleRunningTurns(store, {
    now: new Date("2026-05-28T01:00:30.000Z")
  });

  assert.equal(count, 1);
  assert.deepEqual(failed, ["dead"]);
});

test("cleanupStaleRunningTurns fails only expired running records", () => {
  const records: RunningTurnRecord[] = [
    { id: "old-running", status: "running", startedAt: "2026-05-28T00:00:00.000Z" },
    { id: "new-running", status: "running", startedAt: "2026-05-28T00:09:30.000Z" },
    { id: "old-completed", status: "completed", startedAt: "2026-05-28T00:00:00.000Z" }
  ];
  const failed: Array<{ id: string; error: string; finishedAt: string }> = [];
  const store: TurnCleanupStore = {
    listRunningTurns: () => records,
    markTurnFailed: (id, error, finishedAt) => {
      failed.push({ id, error, finishedAt });
    }
  };

  const count = new TurnOrchestrator().cleanupStaleRunningTurns(store, {
    now: new Date("2026-05-28T00:10:01.000Z"),
    timeoutMs: 10 * 60 * 1000
  });

  assert.equal(count, 1);
  assert.equal(failed[0]?.id, "old-running");
});

test("prepareTurnMemory invokes sync and snapshot gateway functions", async () => {
  const orchestrator = new TurnOrchestrator();
  let syncCalled = false;
  let snapshotCalled = false;
  
  const mockMemoryGateway = {
    syncExternalMemories: async () => {
      syncCalled = true;
    },
    createPromptSnapshot: async (scope: any, text: string, limit: number) => {
      snapshotCalled = true;
      assert.equal(scope.channel, "telegram");
      assert.equal(scope.externalUserId, "chat-1");
      assert.equal(scope.botId, "assistant");
      assert.equal(scope.projectId, "project-1");
      assert.equal(text, "query text");
      assert.equal(limit, 12);
      return { fingerprint: "fp-123" };
    }
  };

  const snapshot = await orchestrator.prepareTurnMemory({
    channel: "telegram",
    externalUserId: "chat-1",
    botId: "assistant",
    projectId: "project-1"
  }, "query text", mockMemoryGateway as any);
  assert.equal(syncCalled, true);
  assert.equal(snapshotCalled, true);
  assert.equal(snapshot.fingerprint, "fp-123");
});

test("abortRunningTurnsForSession only clears running turns for that session", () => {
  const orchestrator = new TurnOrchestrator();
  const sessionId = `session-abort-${Date.now()}-${Math.random()}`;
  const otherSessionId = `session-abort-other-${Date.now()}-${Math.random()}`;
  const runId = `run-abort-${Date.now()}-${Math.random()}`;
  const completedRunId = `run-abort-completed-${Date.now()}-${Math.random()}`;
  const otherRunId = `run-abort-other-${Date.now()}-${Math.random()}`;

  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
  `).run(runId, sessionId);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'completed', datetime('now'))
  `).run(completedRunId, sessionId);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
  `).run(otherRunId, otherSessionId);
  db.close();

  const count = orchestrator.abortRunningTurnsForSession(sessionId, "Stopped stale lock.");

  const db2 = new DatabaseSync(storagePaths.settingsDbFile);
  const rows = db2.prepare("SELECT id, status, error FROM runs WHERE id IN (?, ?, ?)").all(runId, completedRunId, otherRunId) as Array<{ id: string; status: string; error: string | null }>;
  db2.close();
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(count, 1);
  assert.equal(byId[runId].status, "aborted");
  assert.equal(byId[runId].error, "Stopped stale lock.");
  assert.equal(byId[completedRunId].status, "completed");
  assert.equal(byId[otherRunId].status, "running");
});

test("commitTurn updates status and appends summary to store", () => {
  const orchestrator = new TurnOrchestrator();
  const runId = `run-commit-${Date.now()}-${Math.random()}`;
  const sessionId = `session-commit-${Date.now()}-${Math.random()}`;

  let appendedSummary: any = null;
  const mockStore = {
    appendRunSummary: (chatId: string, summary: any) => {
      assert.equal(chatId, "chat-1");
      appendedSummary = summary;
    }
  };

  // Pre-insert run to verify status updates
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  db.prepare(`
    INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
    VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
  `).run(runId, sessionId);
  db.close();

  const summary = {
    runId,
    sessionId,
    stopReason: "stop" as const,
    durationMs: 456,
    finalText: "done",
    toolNames: [],
    failedToolNames: [],
    explicitSkillNames: [],
    usedFallbackModel: false,
    modelFailureSummaries: [],
    budget: {} as any,
    budgetLimits: {} as any,
    errorMessage: "no error"
  };

  orchestrator.commitTurn("chat-1", summary, mockStore as any);

  assert.deepEqual(appendedSummary, summary);

  // Check database status
  const db2 = new DatabaseSync(storagePaths.settingsDbFile);
  const row = db2.prepare("SELECT status, error FROM runs WHERE id = ?").get(runId) as { status: string; error: string };
  db2.close();

  assert.equal(row.status, "completed");
  assert.equal(row.error, "no error");
});

test("commitTurn revokes turn-scoped grants but not session grants", () => {
  const runId = `run-cleanup-${Date.now()}-${Math.random()}`;
  const sessionId = `session-cleanup-${Date.now()}-${Math.random()}`;

  // Use in-memory approval store for test isolation
  const approvalStore = new SqliteApprovalStore(':memory:');
  const approvalBroker = new ApprovalBroker(approvalStore);
  const orchestrator = new TurnOrchestrator(approvalBroker);

  const mockStore = { appendRunSummary: () => {} };

  // Pre-insert run record into settings DB (required by TurnOrchestrator internals)
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  // Insert grants into the in-memory store with unique IDs
  const now = new Date().toISOString();
  const grantTurnId = `grant-turn-${Date.now()}-${Math.random()}`;
  const grantOnceId = `grant-once-${Date.now()}-${Math.random()}`;
  const grantSessionId = `grant-session-${Date.now()}-${Math.random()}`;
  try {
    db.prepare(`
      INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
      VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
    `).run(runId, sessionId);

    approvalStore.saveGrant({ id: grantTurnId, scope: "turn", capability: "host:bash", actorId: "agent-1", workspaceId: "personal", sessionId, runId, createdAt: now });
    approvalStore.saveGrant({ id: grantOnceId, scope: "once", capability: "host:bash", actorId: "agent-1", workspaceId: "personal", sessionId, runId, createdAt: now });
    approvalStore.saveGrant({ id: grantSessionId, scope: "session", capability: "host:bash", actorId: "agent-1", workspaceId: "personal", sessionId, runId, createdAt: now });
  } finally {
    db.close();
  }

  const summary = {
    runId,
    sessionId,
    stopReason: "stop" as const,
    durationMs: 123,
    finalText: "ok",
    toolNames: [],
    failedToolNames: [],
    explicitSkillNames: [],
    usedFallbackModel: false,
    modelFailureSummaries: [],
    budget: {} as any,
    budgetLimits: {} as any
  };

  try {
    orchestrator.commitTurn("chat-1", summary, mockStore as any);

    // Check grants in the in-memory store via listActiveGrants (filters revoked)
    const grants = approvalStore.listActiveGrants();
    const byId = Object.fromEntries(grants.map((g: any) => [g.id, g]));

    // turn and once grants should be revoked (absent from active list)
    assert.equal(byId[grantTurnId], undefined, "turn grant should be revoked");
    assert.equal(byId[grantOnceId], undefined, "once grant should be revoked");
    // session grant should NOT be revoked (still in active list)
    assert.ok(byId[grantSessionId], "session grant should remain active");
  } finally {
    approvalStore.close();
    // Clean up run record from settings DB
    const db2 = new DatabaseSync(storagePaths.settingsDbFile);
    try {
      db2.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    } finally {
      db2.close();
    }
  }
});

test("abortRunningTurnsForSession revokes session grants only when turns were aborted", () => {
  const sessionId = `session-abort-grants-${Date.now()}-${Math.random()}`;
  const runId = `run-abort-grants-${Date.now()}-${Math.random()}`;

  const approvalStore = new SqliteApprovalStore(':memory:');
  const approvalBroker = new ApprovalBroker(approvalStore);
  const orchestrator = new TurnOrchestrator(approvalBroker);

  const db = new DatabaseSync(storagePaths.settingsDbFile);
  try {
    db.prepare(`
      INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at)
      VALUES (?, ?, 'user-1', 'web', 'running', datetime('now'))
    `).run(runId, sessionId);

    const now = new Date().toISOString();
    const grantSessionId = `grant-session-${Date.now()}-${Math.random()}`;
    approvalStore.saveGrant({ id: grantSessionId, scope: "session", capability: "host:bash", actorId: "agent-1", workspaceId: "personal", sessionId, runId, createdAt: now });
  } finally {
    db.close();
  }

  try {
    const count = orchestrator.abortRunningTurnsForSession(sessionId, "Stopped by user.");
    assert.equal(count, 1);

    // Check session grant is revoked (not in active grants)
    const activeGrants = approvalStore.listActiveGrants();
    assert.equal(activeGrants.length, 0, "session grant should be revoked after abort");
  } finally {
    approvalStore.close();
    // Clean up run record
    const db2 = new DatabaseSync(storagePaths.settingsDbFile);
    try {
      db2.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    } finally {
      db2.close();
    }
  }
});

test("abortRunningTurnsForSession does not revoke session grants when no turns were aborted", () => {
  const sessionId = `session-noabort-grants-${Date.now()}-${Math.random()}`;

  const approvalStore = new SqliteApprovalStore(':memory:');
  const approvalBroker = new ApprovalBroker(approvalStore);
  const orchestrator = new TurnOrchestrator(approvalBroker);

  // No running turns for this session
  const now = new Date().toISOString();
  const grantSessionId = `grant-session-${Date.now()}-${Math.random()}`;
  approvalStore.saveGrant({ id: grantSessionId, scope: "session", capability: "host:bash", actorId: "agent-1", workspaceId: "personal", sessionId, runId: "run-other", createdAt: now });

  try {
    const count = orchestrator.abortRunningTurnsForSession(sessionId, "Stopped by user.");
    assert.equal(count, 0);

    // Check session grant is NOT revoked (still in active grants)
    const activeGrants = approvalStore.listActiveGrants();
    assert.equal(activeGrants.length, 1, "session grant should NOT be revoked when no turns were aborted");
    assert.equal(activeGrants[0].id, grantSessionId);
  } finally {
    approvalStore.close();
  }
});

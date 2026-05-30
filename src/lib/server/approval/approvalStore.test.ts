import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { SqliteApprovalStore } from "$lib/server/approval/approvalStore.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";

function request(input: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "request-1",
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    capability: "host:bash",
    riskLevel: "high",
    action: {
      type: "bash",
      command: "git status"
    },
    reason: "test",
    status: "pending",
    requestedBy: {
      agentId: "agent-1",
      depth: 0
    },
    scopeOptions: ["once", "session", "workspace"],
    actionFingerprint: "fingerprint-1",
    createdAt: "2026-05-28T00:00:00.000Z",
    ...input
  };
}

test("SqliteApprovalStore persists approval requests and grants", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    const broker = new ApprovalBroker(store);
    broker.createRequest(request());

    const resolved = broker.resolveRequest({
      requestId: "request-1",
      status: "approved",
      selectedScope: "workspace",
      grantId: "grant-1",
      resolvedAt: new Date("2026-05-28T00:01:00.000Z")
    });

    assert.equal(resolved.request?.status, "approved");
    assert.equal(store.getRequest("request-1")?.selectedScope, "workspace");
    assert.ok(broker.checkGrant({
      capability: "host:bash",
      actorId: "agent-1",
      workspaceId: "personal",
      sessionId: "session-2",
      runId: "run-2",
      actionFingerprint: "fingerprint-1"
    }));
  } finally {
    store.close();
  }
});

test("SqliteApprovalStore revokeGrant marks grant inactive", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    const broker = new ApprovalBroker(store);
    broker.createRequest(request());
    const resolved = broker.resolveRequest({
      requestId: "request-1",
      status: "approved",
      selectedScope: "workspace",
      grantId: "grant-1",
      resolvedAt: new Date("2026-05-28T00:01:00.000Z")
    });

    assert.ok(resolved.grant);

    const revoked = broker.revokeGrant("grant-1");
    assert.equal(revoked, true);

    const grantCheck = broker.checkGrant({
      capability: "host:bash",
      actorId: "agent-1",
      workspaceId: "personal",
      sessionId: "session-2",
      runId: "run-2",
      actionFingerprint: "fingerprint-1"
    });
    assert.equal(grantCheck, null);

    assert.equal(broker.revokeGrant("grant-1"), false);
  } finally {
    store.close();
  }
});

test("SqliteApprovalStore supports timeout expiration through ApprovalBroker", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    const broker = new ApprovalBroker(store);
    broker.createRequest(request({ id: "old", createdAt: "2026-05-28T00:00:00.000Z" }));

    const expired = broker.expirePendingRequests({
      now: new Date("2026-05-28T00:05:01.000Z"),
      timeoutMs: 5 * 60 * 1000
    });

    assert.deepEqual(expired.map((item) => item.id), ["old"]);
    assert.equal(store.getRequest("old")?.status, "expired");
  } finally {
    store.close();
  }
});

test("SqliteApprovalStore revokeTurnGrants revokes turn and once grants for a run", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    const broker = new ApprovalBroker(store);

    // Create and approve requests to get grants
    broker.createRequest(request({ id: "req-turn", runId: "run-1" }));
    broker.resolveRequest({ requestId: "req-turn", status: "approved", selectedScope: "turn", grantId: "grant-turn" });

    broker.createRequest(request({ id: "req-once", runId: "run-1" }));
    broker.resolveRequest({ requestId: "req-once", status: "approved", selectedScope: "once", grantId: "grant-once" });

    broker.createRequest(request({ id: "req-session", runId: "run-1" }));
    broker.resolveRequest({ requestId: "req-session", status: "approved", selectedScope: "session", grantId: "grant-session" });

    broker.createRequest(request({ id: "req-other-turn", runId: "run-2" }));
    broker.resolveRequest({ requestId: "req-other-turn", status: "approved", selectedScope: "turn", grantId: "grant-other-turn" });

    const count = broker.revokeTurnGrants("run-1");
    assert.equal(count, 2);

    // turn grant for run-1 should be inactive:
    // use a different sessionId so the session grant doesn't match
    assert.equal(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "other-session", runId: "run-1", actionFingerprint: "fingerprint-1"
    }), null);

    // session grant for run-1 should still be active (different run, same session)
    assert.ok(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "session-1", runId: "run-99", actionFingerprint: "fingerprint-1"
    }));

    // other-run turn grant should still be active
    assert.ok(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "session-1", runId: "run-2", actionFingerprint: "fingerprint-1"
    }));
  } finally {
    store.close();
  }
});

test("SqliteApprovalStore revokeSessionGrants revokes session grants for a session", () => {
  const store = new SqliteApprovalStore(":memory:");
  try {
    const broker = new ApprovalBroker(store);

    broker.createRequest(request({ id: "req-session", sessionId: "session-1" }));
    broker.resolveRequest({ requestId: "req-session", status: "approved", selectedScope: "session", grantId: "grant-session" });

    broker.createRequest(request({ id: "req-turn", sessionId: "session-1", runId: "run-1" }));
    broker.resolveRequest({ requestId: "req-turn", status: "approved", selectedScope: "turn", grantId: "grant-turn" });

    broker.createRequest(request({ id: "req-other-session", sessionId: "session-2" }));
    broker.resolveRequest({ requestId: "req-other-session", status: "approved", selectedScope: "session", grantId: "grant-other-session" });

    const count = broker.revokeSessionGrants("session-1");
    assert.equal(count, 1);

    // session grant for session-1 should be inactive
    assert.equal(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "session-1", runId: "run-99", actionFingerprint: "fingerprint-1"
    }), null);

    // turn grant for session-1 should still be active (matches by runId)
    assert.ok(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "session-1", runId: "run-1", actionFingerprint: "fingerprint-1"
    }));

    // other session grant should still be active
    assert.ok(broker.checkGrant({
      capability: "host:bash", actorId: "agent-1", workspaceId: "personal",
      sessionId: "session-2", runId: "run-99", actionFingerprint: "fingerprint-1"
    }));
  } finally {
    store.close();
  }
});

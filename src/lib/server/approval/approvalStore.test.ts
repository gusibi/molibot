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

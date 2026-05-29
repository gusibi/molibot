import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalGrant, ApprovalRequest } from "$lib/server/approval/approvalTypes.js";

function grant(input: Partial<ApprovalGrant>): ApprovalGrant {
  return {
    id: "grant-1",
    scope: "session",
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    runId: "run-1",
    createdAt: "2026-05-28T00:00:00.000Z",
    ...input
  };
}

function request(input: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "request-1",
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    capability: "bash:git",
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
    scopeOptions: ["once", "session"],
    createdAt: "2026-05-28T00:00:00.000Z",
    ...input
  };
}

test("checkGrant matches session scope without crossing sessions", () => {
  const store = new MemoryApprovalBrokerStore();
  store.saveGrant(grant({ scope: "session" }));
  const broker = new ApprovalBroker(store);

  assert.ok(broker.checkGrant({
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    runId: "another-run"
  }));
  assert.equal(broker.checkGrant({
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-2",
    runId: "another-run"
  }), null);
});

test("resolveRequest creates scoped grant only when approved", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  broker.createRequest(request());

  const result = broker.resolveRequest({
    requestId: "request-1",
    status: "approved",
    selectedScope: "workspace",
    grantId: "grant-workspace",
    resolvedAt: new Date("2026-05-28T00:01:00.000Z")
  });

  assert.equal(result.request?.status, "approved");
  assert.equal(result.grant?.scope, "workspace");
  assert.ok(broker.checkGrant({
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "other-session",
    runId: "other-run"
  }));
});

test("expirePendingRequests marks old pending requests expired", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  broker.createRequest(request({ id: "old", createdAt: "2026-05-28T00:00:00.000Z" }));
  broker.createRequest(request({ id: "fresh", createdAt: "2026-05-28T00:04:30.000Z" }));

  const expired = broker.expirePendingRequests({
    now: new Date("2026-05-28T00:05:01.000Z"),
    timeoutMs: 5 * 60 * 1000
  });

  assert.deepEqual(expired.map((item) => item.id), ["old"]);
  assert.equal(store.getRequest("old")?.status, "expired");
  assert.equal(store.getRequest("fresh")?.status, "pending");
});

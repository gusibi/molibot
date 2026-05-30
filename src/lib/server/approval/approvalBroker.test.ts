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

test("revokeGrant marks grant inactive and checkGrant returns null", () => {
  const store = new MemoryApprovalBrokerStore();
  store.saveGrant(grant({ id: "grant-1", scope: "session" }));
  const broker = new ApprovalBroker(store);

  assert.ok(broker.checkGrant({
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    runId: "run-1"
  }));

  const result = broker.revokeGrant("grant-1");
  assert.equal(result, true);

  assert.equal(broker.checkGrant({
    capability: "bash:git",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    runId: "run-1"
  }), null);
});

test("revokeGrant returns false for unknown grant id", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  assert.equal(broker.revokeGrant("nonexistent"), false);
});

test("revokeGrant returns false for already revoked grant", () => {
  const store = new MemoryApprovalBrokerStore();
  store.saveGrant(grant({ id: "grant-1", revokedAt: "2026-05-28T00:01:00.000Z" }));
  const broker = new ApprovalBroker(store);

  assert.equal(broker.revokeGrant("grant-1"), false);
});

test("revokeTurnGrants revokes turn-scoped grants for a run and leaves other grants active", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  store.saveGrant(grant({ id: "grant-turn", scope: "turn", runId: "run-1" }));
  store.saveGrant(grant({ id: "grant-once", scope: "once", runId: "run-1" }));
  store.saveGrant(grant({ id: "grant-session", scope: "session", sessionId: "session-1", runId: "run-1" }));
  store.saveGrant(grant({ id: "grant-other-turn", scope: "turn", runId: "run-2" }));

  const count = broker.revokeTurnGrants("run-1");

  assert.equal(count, 2);

  // turn/once grants for run-1 should be revoked:
  // checkGrant with a different session so the session grant doesn't match
  assert.equal(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "other-session", runId: "run-1"
  }), null);

  // session-scoped grant should still be active (different run, same session)
  assert.ok(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "session-1", runId: "run-99"
  }));

  // other-run turn grant should still be active
  assert.ok(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "session-1", runId: "run-2"
  }));
});

test("revokeSessionGrants revokes session-scoped grants and leaves other grants active", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  store.saveGrant(grant({ id: "grant-session", scope: "session", sessionId: "session-1" }));
  store.saveGrant(grant({ id: "grant-turn", scope: "turn", runId: "run-1", sessionId: "session-1" }));
  store.saveGrant(grant({ id: "grant-once", scope: "once", runId: "run-1", sessionId: "session-1" }));
  store.saveGrant(grant({ id: "grant-other-session", scope: "session", sessionId: "session-2" }));

  const count = broker.revokeSessionGrants("session-1");

  assert.equal(count, 1);

  // session-scoped for session-1 should be revoked
  assert.equal(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "session-1", runId: "run-99"
  }), null);

  // turn-scoped for session-1 should still be active (it matches by runId)
  assert.ok(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "session-1", runId: "run-1"
  }));

  // other-session grant should still be active
  assert.ok(broker.checkGrant({
    capability: "bash:git", actorId: "agent-1", workspaceId: "personal",
    sessionId: "session-2", runId: "run-99"
  }));
});

test("revokeTurnGrants returns 0 when no matching grants exist", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  const count = broker.revokeTurnGrants("no-such-run");
  assert.equal(count, 0);
});

test("revokeSessionGrants returns 0 when no matching grants exist", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  const count = broker.revokeSessionGrants("no-such-session");
  assert.equal(count, 0);
});

test("revokeTurnGrants does not double-count already revoked grants", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  store.saveGrant(grant({ id: "grant-turn", scope: "turn", runId: "run-1" }));
  store.saveGrant(grant({ id: "grant-once-revoked", scope: "once", runId: "run-1", revokedAt: "2026-05-28T00:01:00.000Z" }));

  const count = broker.revokeTurnGrants("run-1");
  assert.equal(count, 1);
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

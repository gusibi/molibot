import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import { listDesktopBrokerApprovals, resolveDesktopBrokerApproval } from "$lib/server/app/desktopApprovals.js";

function request(input: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "miniapp-request",
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    capability: "builtin:miniAppManage",
    riskLevel: "critical",
    action: { type: "file_write", toolName: "miniAppManage", path: "scratch/todo" },
    reason: "Install the validated Mini App",
    status: "pending",
    requestedBy: { agentId: "agent-1", depth: 0 },
    scopeOptions: ["once", "session", "persistent"],
    createdAt: "2026-08-09T00:00:00.000Z",
    ...input
  };
}

test("Desktop lists Broker tool approvals only for the requested session", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  broker.createRequest(request());
  broker.createRequest(request({ id: "other-request", sessionId: "session-2" }));

  const approvals = listDesktopBrokerApprovals(broker, "session-1");

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.requestId, "miniapp-request");
  assert.equal(approvals[0]?.request.toolId, "miniAppManage");
  assert.match(approvals[0]?.request.reason ?? "", /Install the validated Mini App/);
});

test("Desktop resolves Broker approvals with the selected scope", () => {
  for (const [decision, expectedScope] of [
    ["approve_once", "once"],
    ["approve_session", "session"],
    ["approve_persistent", "persistent"]
  ] as const) {
    const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
    broker.createRequest(request());

    assert.deepEqual(resolveDesktopBrokerApproval(broker, {
      sessionId: "session-1",
      requestId: "miniapp-request",
      decision
    }), { status: "approved" });
    assert.equal(broker.getRequest("miniapp-request")?.selectedScope, expectedScope);
  }
});

test("Desktop rejects Broker approval without creating a grant", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  broker.createRequest(request());

  assert.deepEqual(resolveDesktopBrokerApproval(broker, {
    sessionId: "session-1",
    requestId: "miniapp-request",
    decision: "reject"
  }), { status: "rejected" });
  assert.equal(broker.getRequest("miniapp-request")?.status, "rejected");
  assert.equal(broker.checkGrant({
    capability: "builtin:miniAppManage",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    runId: "run-1"
  }), null);
});

test("Desktop cannot resolve a Broker request owned by another session", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  broker.createRequest(request());

  assert.equal(resolveDesktopBrokerApproval(broker, {
    sessionId: "session-2",
    requestId: "miniapp-request",
    decision: "approve_once"
  }), null);
  assert.equal(broker.getRequest("miniapp-request")?.status, "pending");
});

import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { BrokerApprovalService } from "$lib/server/approval/approvalService.js";
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
    // Relative to now: the Broker expires pending requests past a wall-clock
    // TTL, so a fixed past timestamp silently turns "pending" into "expired".
    createdAt: new Date().toISOString(),
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

test("a tool waiting on approval executes exactly once when the card is double-clicked in its window", async () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const service = new BrokerApprovalService(broker);
  const pending = request();
  broker.createRequest(pending);

  // The tool call is suspended here, holding the "approval window" open. A
  // real run reaches this state via ToolRuntime's broker poll loop; the
  // service façade is its shared, store-injectable stand-in.
  let executions = 0;
  const waiting = service
    .waitForDecision({ request: pending, timeoutMs: 5_000, pollMs: 1 })
    .then((decision) => {
      if (decision === "approved") executions += 1;
      return decision;
    });

  // Two clicks land before the run resumes - the exact race the card guards.
  const first = resolveDesktopBrokerApproval(broker, { sessionId: "session-1", requestId: pending.id, decision: "approve_once" });
  const second = resolveDesktopBrokerApproval(broker, { sessionId: "session-1", requestId: pending.id, decision: "approve_once" });

  assert.deepEqual(first, { status: "approved" });
  assert.equal(second, null, "the second activation is not a second decision");
  assert.equal(await waiting, "approved");
  assert.equal(executions, 1, "the tool runs once, not once per click");
  assert.equal(store.listActiveGrants().length, 1, "exactly one grant is recorded");
});

test("an approval answered after the waiting run was aborted never executes", async () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const service = new BrokerApprovalService(broker);
  const pending = request();
  broker.createRequest(pending);

  // The run is stopped while the card is still on screen. The waiter expires
  // the request instead of leaving a card whose later click would do nothing.
  const decision = await service.waitForDecision({
    request: pending,
    timeoutMs: 5_000,
    pollMs: 1,
    signal: { aborted: true }
  });
  assert.equal(decision, "expired");
  assert.equal(broker.getRequest(pending.id)?.status, "expired");

  // A click that arrives after the abort is a no-op: no grant, no execution.
  assert.equal(resolveDesktopBrokerApproval(broker, { sessionId: "session-1", requestId: pending.id, decision: "approve_once" }), null);
  assert.equal(store.listActiveGrants().length, 0);
});

test("resolving one conversation's approval leaves another conversation's request untouched", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  broker.createRequest(request());
  broker.createRequest(request({ id: "other-request", sessionId: "session-2", actorId: "agent-1" }));

  // The user is viewing session-2 when the session-1 decision is submitted;
  // the decision still targets its own request only.
  assert.deepEqual(resolveDesktopBrokerApproval(broker, {
    sessionId: "session-1",
    requestId: "miniapp-request",
    decision: "approve_once"
  }), { status: "approved" });

  assert.equal(broker.getRequest("other-request")?.status, "pending");
  assert.deepEqual(listDesktopBrokerApprovals(broker, "session-2").map((approval) => approval.requestId), ["other-request"]);
});

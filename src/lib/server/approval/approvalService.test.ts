import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { BrokerApprovalService } from "$lib/server/approval/approvalService.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "req-1",
    runId: "run-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    actorId: "actor-1",
    capability: "bash:host-bash",
    riskLevel: "high",
    action: { type: "bash", command: "git status", toolName: "host-bash" },
    reason: "needs host access",
    status: "pending",
    requestedBy: { agentId: "actor-1", depth: 0 },
    scopeOptions: ["once", "session"],
    createdAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

function fakeClock() {
  let clock = 0;
  return { now: () => clock, sleep: async (ms: number) => { clock += ms; } };
}

test("BrokerApprovalService.checkGrant delegates to the broker", () => {
  const store = new MemoryApprovalBrokerStore();
  store.saveGrant({
    id: "g1",
    scope: "session",
    capability: "bash:host-bash",
    actorId: "actor-1",
    workspaceId: "ws-1",
    sessionId: "sess-1",
    createdAt: "2026-06-20T00:00:00.000Z"
  });
  const service = new BrokerApprovalService(new ApprovalBroker(store));

  const grant = service.checkGrant({
    capability: "bash:host-bash",
    actorId: "actor-1",
    workspaceId: "ws-1",
    sessionId: "sess-1",
    runId: "run-1"
  });
  assert.equal(grant?.id, "g1");
});

test("BrokerApprovalService.waitForDecision returns the terminal status already on the request", async () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const service = new BrokerApprovalService(broker);
  const req = request();
  service.createRequest(req);
  broker.updateRequest({ ...req, status: "approved" });

  const decision = await service.waitForDecision({ request: req, timeoutMs: 1000, pollMs: 10, ...fakeClock() });
  assert.equal(decision, "approved");
});

test("BrokerApprovalService.waitForDecision returns expired when the signal is aborted", async () => {
  const store = new MemoryApprovalBrokerStore();
  const service = new BrokerApprovalService(new ApprovalBroker(store));
  const req = request();
  service.createRequest(req);

  const decision = await service.waitForDecision({
    request: req,
    timeoutMs: 1000,
    pollMs: 10,
    signal: { aborted: true },
    ...fakeClock()
  });
  assert.equal(decision, "expired");
});

test("BrokerApprovalService.waitForDecision expires the request on timeout", async () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const service = new BrokerApprovalService(broker);
  const req = request();
  service.createRequest(req);

  const decision = await service.waitForDecision({ request: req, timeoutMs: 30, pollMs: 10, ...fakeClock() });
  assert.equal(decision, "expired");
  assert.equal(broker.getRequest(req.id)?.status, "expired");
});

test("BrokerApprovalService.resolve approves the request and records a grant", () => {
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const service = new BrokerApprovalService(broker);
  const req = request();
  service.createRequest(req);

  service.resolve({ requestId: req.id, status: "approved", selectedScope: "session" });
  assert.equal(broker.getRequest(req.id)?.status, "approved");
  assert.equal(store.listActiveGrants().length, 1);
});

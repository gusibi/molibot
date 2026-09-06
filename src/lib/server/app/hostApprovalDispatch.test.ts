import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostBashStore } from "$lib/server/hostBash/store.js";
import { SqliteApprovalStore } from "$lib/server/approval/approvalStore.js";
import { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { resolveDesktopBrokerApproval, listDesktopBrokerApprovals } from "$lib/server/app/desktopApprovals.js";
import { executeHostBashApproval, rewriteApprovalToolResultInContext } from "$lib/server/agent/hostBashExec.js";

test("Desktop leaves Host Bash approvals to the executor and writes the command result back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "approval-dispatch-"));
  const path = join(dir, "settings.sqlite");
  const host = new HostBashStore(path);
  const brokerStore = new SqliteApprovalStore(path);
  const broker = new ApprovalBroker(brokerStore);
  try {
    const record = host.requestApproval({
      toolId: "printf", command: "printf", reason: "test", channel: "web",
      scopeId: "web:personal:test", chatId: "web:personal:test", sessionId: "session-1",
      pendingAction: { kind: "run_approved_host_bash", originalCommand: "printf approval-ok", args: ["approval-ok"] }
    }).approval!;
    assert.deepEqual(listDesktopBrokerApprovals(broker, "session-1"), []);
    assert.equal(resolveDesktopBrokerApproval(broker, {
      sessionId: "session-1", requestId: record.id, decision: "approve_once"
    }), null);
    assert.equal(host.listPending(record.scopeId, "session-1").find((item) => item.id === record.id)?.status, "pending");
    const approved = host.approve(record.scopeId, record.id, { scope: "once", sessionId: "session-1" })!;
    const output = await executeHostBashApproval({ record: approved.record, approvedTool: approved.approved, cwd: dir });
    const messages = [{ role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "Host Bash approval requested." }], details: { hostBashApproval: { requestId: record.id } } }];
    assert.equal(rewriteApprovalToolResultInContext(messages, record.id, output.rendered), true);
    assert.match(messages[0].content[0].text, /approval-ok/);
  } finally {
    brokerStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Host Bash rejection and execution terminal states are never resolved by the broker", () => {
  const dir = mkdtempSync(join(tmpdir(), "approval-ownership-"));
  const path = join(dir, "settings.sqlite");
  const host = new HostBashStore(path);
  const brokerStore = new SqliteApprovalStore(path);
  const broker = new ApprovalBroker(brokerStore);
  try {
    const record = host.requestApproval({
      command: "printf", reason: "test", channel: "web", scopeId: "scope", chatId: "scope", sessionId: "session-1"
    }).approval!;
    assert.equal(resolveDesktopBrokerApproval(broker, { sessionId: "session-1", requestId: record.id, decision: "reject" }), null);
    assert.equal(host.reject("scope", record.id, "session-1")?.status, "rejected");
    for (const status of ["executed", "failed"] as const) {
      host.markExecution(record.id, status);
      assert.equal(broker.getRequest(record.id), null);
      assert.equal(resolveDesktopBrokerApproval(broker, { sessionId: "session-1", requestId: record.id, decision: "approve_once" }), null);
      assert.equal(host.getApprovalRecord(record.id)?.status, status);
    }
  } finally {
    brokerStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("result rewriting targets one approval even when commands repeat", () => {
  const messages = ["first", "second"].map((requestId) => ({
    role: "toolResult", content: [{ type: "text", text: "Host Bash approval requested." }],
    details: { hostBashApproval: { requestId }, retained: true }
  }));
  assert.equal(rewriteApprovalToolResultInContext(messages, "missing", "output"), false);
  assert.equal(rewriteApprovalToolResultInContext(messages, "first", "output"), true);
  assert.equal(messages[0].content[0].text, "output");
  assert.deepEqual(messages[0].details, { retained: true });
  assert.equal(messages[1].content[0].text, "Host Bash approval requested.");
  assert.equal(rewriteApprovalToolResultInContext(messages, "first", "duplicate"), false);
});

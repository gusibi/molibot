// Issue #48: the Host Bash approval wait must suspend the run on every waiting
// outcome. These tests drive the exported waiter directly with a controllable
// store double and assert only the observable tool result shape.
import assert from "node:assert/strict";
import test from "node:test";
import { prepareHostBashApproval, waitForHostBashApprovalAndExecute } from "$lib/server/agent/tools/bash.js";
import { buildHostBashApprovalPrompt, type HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import { HostBashStore } from "$lib/server/hostBash/store.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function prompt(requestId = "hba-test-1"): HostBashApprovalPrompt {
  return {
    type: "host_bash_approval",
    requestId,
    title: "Host Bash approval",
    body: "approve me",
    options: [],
    request: {
      toolId: "longbridge",
      displayName: "longbridge",
      command: "longbridge --version",
      args: ["--version"],
      approvalMode: "persistent",
      reason: "test",
      permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
      requestedAt: new Date().toISOString()
    }
  } as unknown as HostBashApprovalPrompt;
}

function ctx(overrides: Record<string, unknown> = {}): any {
  return {
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "chat-1",
    cwd: process.cwd(),
    signal: new AbortController().signal,
    emit: () => {},
    ...overrides
  };
}

test("approved Host Bash prepares without a claim or process and executes exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-host-prepared-"));
  try {
    const store = new HostBashStore(join(directory, "approvals.sqlite"));
    const requested = store.requestApproval({
      command: "printf prepared > receipt.txt", reason: "test", approvalMode: "ephemeral",
      channel: "web", chatId: "chat-1", scopeId: "scope-1", sessionId: "session-1",
      pendingAction: { kind: "run_one_time_host_script", originalCommand: "printf prepared > receipt.txt", runId: "run-1" }
    });
    assert.ok(requested.approval);
    store.approve("scope-1", requested.approval.id, { scope: "once" });
    const context = ctx({ cwd: directory, workspaceId: "" });
    const prepared = await prepareHostBashApproval({
      store, prompt: buildHostBashApprovalPrompt(requested.approval), scopeId: "scope-1",
      requestText: "test", ctx: context, waitTimeoutMs: 20
    });
    assert.ok("execute" in prepared);
    assert.equal(store.getApprovalRecord(requested.approval.id)?.status, "approved");
    assert.equal(existsSync(join(directory, "receipt.txt")), false);
    assert.equal((await prepared.execute(context)).ok, true);
    assert.equal(readFileSync(join(directory, "receipt.txt"), "utf8"), "prepared");
    assert.equal(store.getApprovalRecord(requested.approval.id)?.status, "executed");
    await assert.rejects(prepared.execute(context), /already consumed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("prepared Host Bash rejects Stop, revoked authority and a lost execution claim", async () => {
  for (const failure of ["stop", "authority", "claim", "scope", "context", "cancel"] as const) {
    const directory = mkdtempSync(join(tmpdir(), "molibot-host-prepared-"));
    try {
      const store = new HostBashStore(join(directory, "approvals.sqlite"));
      const requested = store.requestApproval({
        command: "printf executed > receipt.txt", reason: "test", approvalMode: "ephemeral",
        channel: "web", chatId: "chat-1", scopeId: "scope-1", sessionId: "session-1",
        pendingAction: { kind: "run_one_time_host_script", originalCommand: "printf executed > receipt.txt" }
      });
      assert.ok(requested.approval);
      store.approve("scope-1", requested.approval.id, { scope: "once" });
      const controller = new AbortController();
      let authorized = true;
      const context = ctx({ cwd: directory, workspaceId: "", signal: controller.signal,
        assertAuthority: () => { if (!authorized) throw new Error("authority revoked"); } });
      const prepared = await prepareHostBashApproval({
        store, prompt: buildHostBashApprovalPrompt(requested.approval), scopeId: failure === "scope" ? "another-scope" : "scope-1",
        requestText: "test", ctx: context, waitTimeoutMs: 20
      });
      if (failure === "scope") {
        assert.ok(!("execute" in prepared));
        assert.equal(prepared.ok, false);
      } else {
        assert.ok("execute" in prepared);
        if (failure === "stop") controller.abort();
        if (failure === "authority") authorized = false;
        if (failure === "cancel") {
          assert.ok(prepared.cancel);
          prepared.cancel();
          await assert.rejects(prepared.execute(context), /already consumed/);
        } else if (failure === "context") {
          assert.equal((await prepared.execute({ ...context, sessionId: "another-session" })).ok, false);
          prepared.cancel?.();
        } else if (failure === "claim") {
          assert.equal(store.claimExecution(requested.approval.id), true);
          assert.equal((await prepared.execute(context)).ok, false);
        } else await assert.rejects(prepared.execute(context));
      }
      assert.equal(existsSync(join(directory, "receipt.txt")), false);
      if (failure === "stop" || failure === "cancel" || failure === "context") {
        assert.equal(store.getApprovalRecord(requested.approval.id)?.status, "expired");
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test("Host Bash admission retains invocation identity across reopen and rejects changed arguments", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-host-admission-"));
  try {
    const path = join(directory, "approvals.sqlite");
    const store = new HostBashStore(path);
    const input = {
      invocationId: JSON.stringify(["run", "tool-call"]), command: "printf original > receipt.txt", reason: "test",
      approvalMode: "ephemeral", channel: "web", chatId: "chat", scopeId: "scope", sessionId: "session",
      owner: { kind: "bot", id: "bot" },
      pendingAction: { kind: "run_one_time_host_script", originalCommand: "printf original > receipt.txt", runId: "run" }
    };
    const first = store.requestApproval(input);
    assert.ok(first.approval);
    assert.equal(store.approve("another-scope", first.approval.id), null);
    assert.equal(store.approve("scope", first.approval.id, { sessionId: "another-session" }), null);
    assert.ok(store.approve("scope", first.approval.id, { scope: "once", sessionId: "session" }));
    const reopened = new HostBashStore(path);
    const second = reopened.requestApproval(input);
    assert.equal(second.kind, "existing-request");
    assert.equal(second.approval?.id, first.approval.id);
    assert.equal(second.approval?.status, "approved");
    assert.equal(reopened.requestApproval({ ...input, owner: { ...input.owner, label: "Renamed bot" } }).approval?.id, first.approval.id);
    assert.throws(() => reopened.requestApproval({ ...input,
      pendingAction: { ...input.pendingAction, originalCommand: "printf changed > receipt.txt" }
    }), /identity was reused/);
    const otherOwner = reopened.requestApproval({ ...input, owner: { kind: "bot", id: "another-bot" }, scopeId: "other-scope" });
    assert.notEqual(otherOwner.approval?.id, first.approval.id);
    assert.equal(existsSync(join(directory, "receipt.txt")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an inline window timeout suspends the run with a resumable request id", async () => {
  const record = { id: "hba-test-1", status: "pending" };
  const result = await waitForHostBashApprovalAndExecute({
    store: {
      // Always pending: the user never answers inside the window.
      getApprovalRecord: () => record
    } as any,
    prompt: prompt(),
    scopeId: "scope-1",
    requestText: "Host Bash approval requested.",
    ctx: ctx({ onApprovalRequest: async () => undefined }),
    waitTimeoutMs: 20
  });
  assert.equal(result.terminate, true, "a window timeout must stop the tool loop");
  assert.equal(result.metadata?.status, "waiting_for_approval");
  assert.equal(result.metadata?.approvalRequestId, "hba-test-1");
  assert.equal((result.details as any)?.approvalRequestId, "hba-test-1");
});

test("a deferred decision suspends immediately with the request id attached", async () => {
  const result = await waitForHostBashApprovalAndExecute({
    store: {} as any,
    prompt: prompt("hba-defer-1"),
    scopeId: "scope-1",
    requestText: "Host Bash approval requested.",
    ctx: ctx({ onApprovalRequest: async () => "defer" })
  });
  assert.equal(result.terminate, true);
  assert.equal(result.metadata?.approvalRequestId, "hba-defer-1");
});

test("an aborted wait expires the pending request instead of leaving it answerable", async () => {
  const expired: string[] = [];
  const record = { id: "hba-abort-1", status: "pending" };
  const controller = new AbortController();
  // Register the abort BEFORE awaiting: it fires while the waiter polls.
  setTimeout(() => controller.abort(), 20);
  const result = await waitForHostBashApprovalAndExecute({
    store: {
      getApprovalRecord: () => record,
      expirePending: (id: string) => {
        expired.push(id);
        return true;
      }
    } as any,
    prompt: prompt("hba-abort-1"),
    scopeId: "scope-1",
    requestText: "Host Bash approval requested.",
    ctx: ctx({
      onApprovalRequest: async () => undefined,
      get signal() {
        return controller.signal;
      }
    }),
    waitTimeoutMs: 10_000
  });
  const aborted = result as Awaited<ReturnType<typeof waitForHostBashApprovalAndExecute>>;
  assert.match(String(aborted.error ?? ""), /aborted/i);
  assert.deepEqual(expired, ["hba-abort-1"], "the pending request must end in a terminal state");
});

test("a vanished request record still suspends the run (no blind continuation)", async () => {
  const result = await waitForHostBashApprovalAndExecute({
    store: {
      getApprovalRecord: () => undefined
    } as any,
    prompt: prompt("hba-vanish-1"),
    scopeId: "scope-1",
    requestText: "Host Bash approval requested.",
    ctx: ctx({ onApprovalRequest: async () => undefined }),
    waitTimeoutMs: 10_000
  });
  assert.equal(result.terminate, true, "a vanished record must not let the loop continue");
  assert.equal(result.metadata?.approvalRequestId, "hba-vanish-1");
});

// Unattended automation runs cannot show a card: the deny disposition must
// fail the call without terminating and leave no answerable request behind.
test("an unattended deny expires the request and returns a plain, non-terminating denial", async () => {
  const expired: string[] = [];
  let reads = 0;
  const result = await waitForHostBashApprovalAndExecute({
    store: {
      getApprovalRecord: () => {
        reads += 1;
        return { id: "hba-unattended-1", status: "pending" };
      },
      expirePending: (requestId: string) => {
        expired.push(requestId);
      }
    } as any,
    prompt: prompt("hba-unattended-1"),
    scopeId: "scope-1",
    requestText: "Host Bash approval requested.",
    ctx: ctx({ onApprovalRequest: async () => "deny" })
  });
  assert.equal(result.ok, false, "the call must fail so the model reports the skip");
  assert.notEqual(result.terminate, true, "a denial must not suspend the run");
  assert.deepEqual(expired, ["hba-unattended-1"]);
  assert.equal(reads, 1, "read admission once, without starting a decision polling loop");
  assert.match(String(result.error), /unattended automation run/i);
});

for (const callback of ["approval notification", "durable approval consumption"] as const) {
  test(`Stop during ${callback} expires the decision before suspension or execution`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "molibot-approval-stop-"));
    try {
      const store = new HostBashStore(join(directory, "approvals.sqlite"));
      const requested = store.requestApproval({
        command: "printf stopped > receipt.txt", reason: "test", approvalMode: "ephemeral",
        channel: "web", chatId: "chat-1", scopeId: "scope-1", sessionId: "session-1",
        pendingAction: { kind: "run_one_time_host_script", originalCommand: "printf stopped > receipt.txt" }
      });
      assert.ok(requested.approval);
      const controller = new AbortController();
      const context = ctx({ cwd: directory, signal: controller.signal,
        onApprovalRequest: async () => {
          if (callback === "approval notification") {
            store.approve("scope-1", requested.approval!.id, { scope: "once", sessionId: "session-1" });
            controller.abort();
          }
          return "defer";
        },
        consumeDurableApproval: async () => {
          if (callback === "durable approval consumption") controller.abort();
          return callback === "durable approval consumption" ? "once" : undefined;
        }
      });
      const result = await prepareHostBashApproval({ store,
        prompt: buildHostBashApprovalPrompt(requested.approval), scopeId: "scope-1", requestText: "Approval requested", ctx: context, waitTimeoutMs: 20
      });
      assert.ok(!("execute" in result));
      assert.equal(result.ok, false);
      assert.equal(result.metadata?.status, undefined, "Stop must not become a resumable approval wait");
      assert.equal(store.getApprovalRecord(requested.approval.id)?.status, "expired");
      assert.equal(store.approve("scope-1", requested.approval.id, { scope: "once", sessionId: "session-1" }), null);
      assert.equal(existsSync(join(directory, "receipt.txt")), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

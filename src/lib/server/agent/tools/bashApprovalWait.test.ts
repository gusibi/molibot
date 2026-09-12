// Issue #48: the Host Bash approval wait must suspend the run on every waiting
// outcome. These tests drive the exported waiter directly with a controllable
// store double and assert only the observable tool result shape.
import assert from "node:assert/strict";
import test from "node:test";
import { waitForHostBashApprovalAndExecute } from "$lib/server/agent/tools/bash.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";

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
  const result = await waitForHostBashApprovalAndExecute({
    store: {
      getApprovalRecord: () => {
        throw new Error("must not poll when denying");
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
  assert.match(String(result.error), /unattended automation run/i);
});

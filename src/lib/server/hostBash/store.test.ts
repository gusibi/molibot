import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostBashStore } from "$lib/server/hostBash/store.js";
import { classifyHostBashCommand } from "$lib/server/hostBash/commandClassifier.js";

function createStore(): HostBashStore {
  const dir = mkdtempSync(join(tmpdir(), "hostbash-store-"));
  return new HostBashStore(join(dir, "settings.db"));
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser",
    reason: "Requires browser IPC outside sandbox.",
    approvalMode: "persistent",
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "scope-1",
    sessionId: "session-1",
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "agent-browser --open",
      args: ["--open"]
    },
    ...overrides
  };
}

test("approve with once scope does not persist a whitelist entry", () => {
  const store = createStore();
  const requested = store.requestApproval(requestInput());
  assert.equal(requested.kind, "created");

  const approved = store.approve("scope-1", requested.approval?.id, { scope: "once" });
  assert.ok(approved);
  assert.equal(approved?.approved, undefined);
  assert.equal(store.getApprovedEntry("agent-browser"), null);
  assert.equal(approved?.record.status, "approved");
});

test("approve with persistent scope whitelists every capability of a compound command", () => {
  const store = createStore();
  const classification = classifyHostBashCommand("gh pr list | osascript -e 'beep'");
  assert.equal(classification.kind, "compound-capabilities");

  const requested = store.requestApproval(requestInput({
    toolId: "one-time-gh",
    displayName: "gh + osascript",
    command: "gh pr list | osascript -e 'beep'",
    approvalMode: "ephemeral",
    classification,
    pendingAction: {
      kind: "run_one_time_host_script",
      originalCommand: "gh pr list | osascript -e 'beep'"
    }
  }));
  assert.equal(requested.kind, "created");

  const approved = store.approve("scope-1", requested.approval?.id, { scope: "persistent" });
  assert.ok(approved);
  assert.equal(approved?.approvedEntries?.length, 2);
  assert.ok(store.getApprovedEntry("gh")?.enabled);
  assert.ok(store.getApprovedEntry("osascript")?.enabled);
});

test("new ephemeral request for the same capability expires the older pending card", () => {
  const store = createStore();
  const first = store.requestApproval(requestInput({
    toolId: "one-time-foo",
    approvalMode: "ephemeral",
    command: "foo --a",
    pendingAction: { kind: "run_one_time_host_script", originalCommand: "foo --a" }
  }));
  assert.equal(first.kind, "created");

  const second = store.requestApproval(requestInput({
    toolId: "one-time-foo",
    approvalMode: "ephemeral",
    command: "foo --b",
    pendingAction: { kind: "run_one_time_host_script", originalCommand: "foo --b" }
  }));
  assert.equal(second.kind, "created");

  const pending = store.listPending("scope-1");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.id, second.approval?.id);
  assert.equal(store.getApprovalRecord(first.approval?.id ?? "")?.status, "expired");
});

test("identical ephemeral request reuses the existing pending approval", () => {
  const store = createStore();
  const first = store.requestApproval(requestInput({
    toolId: "one-time-foo",
    approvalMode: "ephemeral",
    command: "foo --a",
    pendingAction: { kind: "run_one_time_host_script", originalCommand: "foo --a" }
  }));
  const second = store.requestApproval(requestInput({
    toolId: "one-time-foo",
    approvalMode: "ephemeral",
    command: "foo --a",
    pendingAction: { kind: "run_one_time_host_script", originalCommand: "foo --a" }
  }));
  assert.equal(second.kind, "existing-pending");
  assert.equal(second.approval?.id, first.approval?.id);
});

test("claimExecution grants execution to exactly one claimant", () => {
  const store = createStore();
  const requested = store.requestApproval(requestInput());
  const id = requested.approval?.id ?? "";

  // Cannot claim while still pending.
  assert.equal(store.claimExecution(id), false);

  store.approve("scope-1", id, { scope: "once" });
  assert.equal(store.claimExecution(id), true);
  assert.equal(store.getApprovalRecord(id)?.status, "executing");
  // Second claimant loses the race.
  assert.equal(store.claimExecution(id), false);

  store.markExecution(id, "executed");
  assert.equal(store.getApprovalRecord(id)?.status, "executed");
});

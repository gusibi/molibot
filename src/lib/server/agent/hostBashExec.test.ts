import test from "node:test";
import assert from "node:assert/strict";
import { executeApprovedHostBash, executeHostBashApproval, hasVisibleHostBashOutput } from "$lib/server/agent/hostBashExec.js";
import type { ApprovedHostBashEntry, HostBashApprovalRecord } from "$lib/server/hostBash/index.js";

function approvedPrintfBash(envAllowlist: string[] = ["PATH"]): ApprovedHostBashEntry {
  return {
    id: "hbw-test-printf",
    toolId: "printf",
    displayName: "printf",
    command: "printf",
    reason: "test",
    permissions: {
      envAllowlist,
      filesystem: "scratch-only",
      network: "none"
    },
    approvedAt: "2026-05-24T00:00:00.000Z",
    approvedFromRecordId: "hba-test",
    channel: "test",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
}

test("executeApprovedHostBash inherits process environment variables", async () => {
  const cwd = process.cwd();
  process.env.MOLIBOT_HOST_BASH_ALLOWED = "visible";
  process.env.MOLIBOT_HOST_BASH_INHERITED = "inherited";
  try {
    const result = await executeApprovedHostBash({
      tool: approvedPrintfBash(["PATH", "MOLIBOT_HOST_BASH_ALLOWED"]),
      cwd,
      originalCommand: "printf '%s/%s' \"${MOLIBOT_HOST_BASH_ALLOWED:-}\" \"${MOLIBOT_HOST_BASH_INHERITED:-}\"",
      args: ["%s/%s", "$MOLIBOT_HOST_BASH_ALLOWED", "$MOLIBOT_HOST_BASH_INHERITED"]
    });

    assert.equal(result.rendered, "visible/inherited");
  } finally {
    delete process.env.MOLIBOT_HOST_BASH_ALLOWED;
    delete process.env.MOLIBOT_HOST_BASH_INHERITED;
  }
});

test("executeHostBashApproval can run session-only approvals without a whitelist entry", async () => {
  const cwd = process.cwd();
  const record: HostBashApprovalRecord = {
    id: "hba-session-printf",
    toolId: "printf",
    displayName: "printf",
    command: "printf",
    reason: "session approval test",
    channel: "test",
    chatId: "chat-1",
    scopeId: "chat-1",
    sessionId: "session-1",
    approvalMode: "persistent",
    status: "approved",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "scratch-only",
      network: "none"
    },
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "printf 'session ok'",
      args: ["session ok"]
    },
    requestedAt: "2026-05-24T00:00:00.000Z"
  };

  const result = await executeHostBashApproval({
    record,
    cwd
  });

  assert.equal(result.rendered, "session ok");
  assert.equal(result.details.hostBash, true);
});

test("executeHostBashApproval renders empty successful output as suppressible", async () => {
  const cwd = process.cwd();
  const record: HostBashApprovalRecord = {
    id: "hba-session-empty",
    toolId: "noop",
    displayName: "noop",
    command: "true",
    reason: "empty output test",
    channel: "test",
    chatId: "chat-1",
    scopeId: "chat-1",
    sessionId: "session-1",
    approvalMode: "persistent",
    status: "approved",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "scratch-only",
      network: "none"
    },
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "true",
      args: []
    },
    requestedAt: "2026-05-24T00:00:00.000Z"
  };

  const result = await executeHostBashApproval({
    record,
    cwd
  });

  assert.equal(result.rendered, "(no output)");
  assert.equal(hasVisibleHostBashOutput(result.rendered), false);
});

test("hasVisibleHostBashOutput suppresses empty success output only", () => {
  assert.equal(hasVisibleHostBashOutput("(no output)"), false);
  assert.equal(hasVisibleHostBashOutput("  (no output)\n"), false);
  assert.equal(hasVisibleHostBashOutput("visible output"), true);
  assert.equal(hasVisibleHostBashOutput("(no output)\n\nHost Bash exited with code 1"), true);
});

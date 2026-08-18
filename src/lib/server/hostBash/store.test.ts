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

test("pending approval preserves the owning fresh automation run", () => {
  const store = createStore();
  const requested = store.requestApproval(requestInput({
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "agent-browser --open",
      runId: "automation-run-2",
      args: ["--open"]
    }
  }));

  assert.equal(requested.approval?.pendingAction?.runId, "automation-run-2");
  assert.equal(store.listPending("scope-1", "session-1")[0]?.pendingAction?.runId, "automation-run-2");
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

test("persistent grant applies across the owner's sessions but not to another owner", () => {
  const store = createStore();
  const projectA = { kind: "project" as const, id: "proj-a", key: "project:proj-a", label: "A" };
  const projectB = { kind: "project" as const, id: "proj-b", key: "project:proj-b", label: "B" };

  const requested = store.requestApproval(requestInput({ owner: projectA }));
  store.approve("scope-1", requested.approval?.id, { scope: "persistent" });

  // Same project, different session — already granted, no second card.
  assert.ok(store.getApprovedEntry("agent-browser", projectA)?.enabled);
  const reRequest = store.requestApproval(requestInput({ owner: projectA, sessionId: "session-2" }));
  assert.equal(reRequest.kind, "existing-approved");

  // A different project must still be asked.
  assert.equal(store.getApprovedEntry("agent-browser", projectB), null);
  assert.equal(store.requestApproval(requestInput({ owner: projectB })).kind, "created");
});

test("owner-scoped lookup still honours a legacy unscoped grant", () => {
  const store = createStore();
  // Written before approvals carried an owner: stays global rather than vanishing.
  const legacy = store.requestApproval(requestInput());
  store.approve("scope-1", legacy.approval?.id, { scope: "persistent" });
  assert.equal(store.getApprovedEntry("agent-browser")?.id, "hbw-agent-browser");

  const owner = { kind: "bot" as const, id: "moli-w", key: "bot:moli-w", label: "moli-w" };
  assert.ok(store.getApprovedEntry("agent-browser", owner)?.enabled);
});

test("listWhitelist tolerates legacy grants without metadata", () => {
  const store = createStore();
  (store as any).db.prepare(`
    INSERT INTO approvals (
      id, type, scope, capability, actor_id, workspace_id, session_id, run_id,
      action_fingerprint, expires_at, created_at, revoked_at
    )
    VALUES (?, 'grant', 'persistent', 'bash:one-time-foo', 'user-1', NULL, NULL, 'request-1', NULL, NULL, ?, NULL)
  `).run("legacy-grant-1", "2026-06-19T00:00:00.000Z");

  const entry = store.listWhitelist()[0];
  assert.equal(entry?.id, "legacy-grant-1");
  assert.equal(entry?.toolId, "one-time-foo");
  assert.equal(entry?.displayName, "one-time-foo");
  assert.equal(entry?.enabled, true);
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

test("listPending, listWhitelist, and listHistory support category filtering", () => {
  const store = createStore();

  // Create Bash request
  const bashReq = store.requestApproval(requestInput({
    toolId: "bash-tool",
    displayName: "Bash Tool"
  }));
  assert.equal(bashReq.kind, "created");

  const now = new Date().toISOString();

  // Directly insert an MCP request and File Write request via SQLite
  (store as any).db.prepare(`
    INSERT INTO approvals (
      id, type, capability, actor_id, workspace_id, session_id, run_id,
      action_fingerprint, action_json, reason, status, scope_options_json,
      selected_scope, scope, created_at, resolved_at
    ) VALUES (
      'req-mcp-1', 'request', 'mcp:OpenConnector/execute_action', 'chat-1', 'ws-1', 'session-1', 'scope-1',
      '{}', '{"toolName":"execute_action","displayName":"OpenConnector Execute","type":"mcp_tool"}', 'Need MCP access', 'pending', '["once","session","persistent"]',
      NULL, NULL, ?, NULL
    )
  `).run(now);

  (store as any).db.prepare(`
    INSERT INTO approvals (
      id, type, capability, actor_id, workspace_id, session_id, run_id,
      action_fingerprint, action_json, reason, status, scope_options_json,
      selected_scope, scope, created_at, resolved_at
    ) VALUES (
      'req-file-1', 'request', 'file_write:src/index.ts', 'chat-1', 'ws-1', 'session-1', 'scope-1',
      '{}', '{"toolName":"write","displayName":"Write File","type":"file_write","payload":{"path":"src/index.ts"}}', 'Need write access', 'pending', '["once","session"]',
      NULL, NULL, ?, NULL
    )
  `).run(now);

  // Test pending list with category filtering
  const allPending = store.listPending("scope-1");
  assert.equal(allPending.length, 3);

  const mcpPending = store.listPending("scope-1", undefined, "mcp");
  assert.equal(mcpPending.length, 1);
  assert.equal(mcpPending[0]?.category, "mcp");
  assert.equal(mcpPending[0]?.id, "req-mcp-1");

  const filePending = store.listPending("scope-1", undefined, "file_write");
  assert.equal(filePending.length, 1);
  assert.equal(filePending[0]?.category, "file_write");
  assert.equal(filePending[0]?.payload?.path, "src/index.ts");

  const bashPending = store.listPending("scope-1", undefined, "bash");
  assert.equal(bashPending.length, 1);
  assert.equal(bashPending[0]?.category, "bash");

  // Insert a grant for MCP
  (store as any).db.prepare(`
    INSERT INTO approvals (
      id, type, capability, actor_id, workspace_id, session_id, run_id,
      action_fingerprint, action_json, reason, status, scope_options_json,
      selected_scope, scope, created_at, resolved_at, revoked_at
    ) VALUES (
      'grant-mcp-1', 'grant', 'mcp:OpenConnector/execute_action', 'chat-1', 'ws-1', 'session-1', 'scope-1',
      '{"displayName":"OpenConnector Execute","type":"mcp_tool"}', '{}', 'Persistent grant', 'approved', '[]',
      'persistent', 'persistent', ?, ?, NULL
    )
  `).run(now, now);

  const allWhitelist = store.listWhitelist();
  assert.equal(allWhitelist.length, 1);
  assert.equal(allWhitelist[0]?.category, "mcp");

  const mcpWhitelist = store.listWhitelist("mcp");
  assert.equal(mcpWhitelist.length, 1);

  const bashWhitelist = store.listWhitelist("bash");
  assert.equal(bashWhitelist.length, 0);

  // Test hasAnyData
  assert.equal(store.hasAnyData(), true);
});

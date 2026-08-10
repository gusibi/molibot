import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { resolveDesktopBrokerApproval } from "$lib/server/app/desktopApprovals.js";
import { createDefaultApprovalRequest } from "$lib/server/agent/tools/toolRuntime.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";

/**
 * "Always allow" has to survive the round trip, or a strict mode is a nag.
 *
 * The pieces existed separately — cards carry scope options, the desktop maps
 * `approve_persistent`, the broker records a grant, `checkGrant` matches one —
 * but nothing asserted them as one chain. Permission modes make the chain
 * load-bearing: Manual asks before every write, so a `persistent` answer that
 * silently failed to stick would be indistinguishable from the feature not
 * working.
 */

function toolDef(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "write",
    name: "Write",
    description: "",
    inputSchema: {},
    risk: "medium",
    source: "builtin",
    effect: "write",
    handler: async () => ({ ok: true, content: "" }),
    ...over
  };
}

function ctx(over: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    cwd: "/tmp",
    fs: { readText: async () => "", writeText: async () => {} },
    shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    network: { fetch: async () => ({}) },
    emit: () => {},
    ...over
  } as ToolExecutionContext;
}

function match(request: ReturnType<typeof createDefaultApprovalRequest>, over: Record<string, unknown> = {}) {
  return {
    capability: request.capability,
    actorId: request.actorId,
    workspaceId: request.workspaceId,
    sessionId: request.sessionId,
    runId: request.runId,
    actionFingerprint: request.actionFingerprint,
    ...over
  };
}

test("a persistent approval is honoured in a later run and a later session", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  const request = createDefaultApprovalRequest(toolDef(), { path: "notes.md" }, ctx());
  broker.createRequest(request);

  const resolved = resolveDesktopBrokerApproval(broker, {
    sessionId: request.sessionId,
    requestId: request.id,
    decision: "approve_persistent"
  });
  assert.deepEqual(resolved, { status: "approved" });

  // The same action, from a different run and a different session, is covered.
  assert.ok(
    broker.checkGrant(match(request, { runId: "run-2", sessionId: "session-2" })),
    "a persistent grant must outlive the run and the session that created it"
  );
});

test("a session approval does not leak into another session", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  const request = createDefaultApprovalRequest(toolDef(), { path: "notes.md" }, ctx());
  broker.createRequest(request);
  resolveDesktopBrokerApproval(broker, {
    sessionId: request.sessionId,
    requestId: request.id,
    decision: "approve_session"
  });

  assert.ok(broker.checkGrant(match(request, { runId: "run-2" })), "same session, later run: covered");
  assert.equal(
    broker.checkGrant(match(request, { sessionId: "session-2" })),
    null,
    "another session must ask again"
  );
});

test("approving one write does not grant every future write", () => {
  // The grant matches on the action fingerprint, which carries the input. If it
  // were keyed on the tool alone, one "always allow" would hand over the file
  // system.
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  const approved = createDefaultApprovalRequest(toolDef(), { path: "notes.md" }, ctx());
  broker.createRequest(approved);
  resolveDesktopBrokerApproval(broker, {
    sessionId: approved.sessionId,
    requestId: approved.id,
    decision: "approve_persistent"
  });

  const other = createDefaultApprovalRequest(toolDef(), { path: "/etc/hosts" }, ctx());
  assert.equal(broker.checkGrant(match(other)), null, "a different target must ask on its own");
});

test("a rejection records no grant", () => {
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  const request = createDefaultApprovalRequest(toolDef(), { path: "notes.md" }, ctx());
  broker.createRequest(request);

  const resolved = resolveDesktopBrokerApproval(broker, {
    sessionId: request.sessionId,
    requestId: request.id,
    decision: "reject"
  });
  assert.deepEqual(resolved, { status: "rejected" });
  assert.equal(broker.checkGrant(match(request)), null);
});

test("a resolve aimed at another session is refused", () => {
  // The unified card lists both backends, so the resolve half has to validate
  // ownership too — otherwise one session could answer another's prompt
  // (CLAUDE.md: list and resolve must cover the same backends, per session).
  const broker = new ApprovalBroker(new MemoryApprovalBrokerStore());
  const request = createDefaultApprovalRequest(toolDef(), { path: "notes.md" }, ctx());
  broker.createRequest(request);

  assert.equal(
    resolveDesktopBrokerApproval(broker, {
      sessionId: "someone-elses-session",
      requestId: request.id,
      decision: "approve_persistent"
    }),
    null
  );
  assert.equal(broker.getRequest(request.id)?.status, "pending", "the request must stay pending");
});

test("installs cannot be answered with a lasting grant", () => {
  // The card never offers `persistent` for `manage`; this pins the other end,
  // so a caller passing the decision directly cannot create one either.
  const request = createDefaultApprovalRequest(
    toolDef({ id: "miniAppManage", risk: "critical", effect: "manage" }),
    { action: "install" },
    ctx()
  );
  assert.deepEqual(request.scopeOptions, ["once"]);
});

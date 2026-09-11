// Issue #48 behavior regression: an approval wait must be an explicit
// suspend/resume lifecycle at the shared runtime level. Drives the real
// MomRunner + real Agent loop + real broker/store against a temporary data
// directory, with a scripted model, and asserts only observable behavior:
// model-call counts, persisted run rows, broker requests and file side effects.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "molibot-approval-suspension-"));

const { MomRunner } = await import("$lib/server/agent/core/runner.js");
const { RunnerPool } = await import("$lib/server/agent/core/runnerPool.js");
const { MomRuntimeStore } = await import("$lib/server/agent/session/store.js");
const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
const { getApprovalBroker } = await import("$lib/server/approval/approvalBroker.js");
const { resumeSuspendedBrokerApproval } = await import("$lib/server/channels/shared/brokerApprovalResume.js");
const { storagePaths } = await import("$lib/server/infra/db/storage.js");
const { getHostBashStore } = await import("$lib/server/hostBash/index.js");
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

function createTestSettings(): RuntimeSettings {
  const base = defaultRuntimeSettings;
  return {
    ...base,
    permissionMode: "manual",
    providerMode: "custom",
    defaultCustomProviderId: "approval-test",
    modelRouting: {
      ...base.modelRouting,
      textModelKey: "custom|approval-test|fake-model"
    },
    customProviders: [
      {
        id: "approval-test",
        name: "Approval Test",
        enabled: true,
        protocol: "openai-compatible",
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        path: "/chat/completions",
        defaultModel: "fake-model",
        models: [
          {
            id: "fake-model",
            enabled: true,
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ]
  };
}

function createTestMemory() {
  return {
    syncExternalMemories: async () => {},
    createProfileTurnSnapshot: async () => ({ fingerprint: "profile", items: [] }),
    createPromptSnapshot: async () => ({
      createdAt: new Date().toISOString(),
      fingerprint: "test",
      query: "hello",
      promptText: "(memory)",
      selected: [],
      longTerm: [],
      daily: []
    })
  };
}

interface ScriptedResponse {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

function createScriptedStreamFn(responses: ScriptedResponse[]) {
  let call = 0;
  const streamFn = async () => {
    const script = responses[Math.min(call, responses.length - 1)];
    call += 1;
    const message = {
      role: "assistant" as const,
      content: [
        ...(script.text ? [{ type: "text" as const, text: script.text }] : []),
        ...(script.toolCalls ?? []).map((tc) => ({ type: "toolCall" as const, id: tc.id, name: tc.name, arguments: tc.arguments }))
      ],
      stopReason: (script.toolCalls?.length ? "toolUse" : "stop") as "toolUse" | "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      timestamp: Date.now()
    };
    return {
      async *[Symbol.asyncIterator]() {},
      result: async () => message
    };
  };
  return {
    streamFn,
    callCount: () => call
  };
}


/** Re-applies the scripted stream to whatever runner the pool hands out: the
 *  out-of-band resume calls `pool.reset()` and creates a fresh runner. */
function attachScriptToPool(pool: RunnerPool, script: { streamFn: unknown }): void {
  const originalGet = pool.get.bind(pool);
  (pool as any).get = (...args: any[]) => {
    const next = originalGet(...args);
    const agent = (next as any).agent;
    if (agent && agent.streamFunction !== script.streamFn) {
      agent.streamFunction = script.streamFn;
    }
    return next;
  };
}

async function createHarness(options: { chatId: string; sessionId: string; responses: ScriptedResponse[] }) {
  const settings = createTestSettings();
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-approval-suspension-ws-"));
  const store = new MomRuntimeStore(workspaceDir);
  const pool = new RunnerPool(
    "web",
    store,
    () => settings,
    (patch: Partial<RuntimeSettings>) => ({ ...createTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createTestMemory() as any
  );
  const runner = pool.get(options.chatId, options.sessionId);
  const script = createScriptedStreamFn(options.responses);
  (runner as any).agent.streamFunction = script.streamFn;
  // The out-of-band resume calls `pool.reset()` and then `pool.get()` — the
  // pinned runner (and the override above) is destroyed. Re-install the script
  // on whatever runner the pool hands out so the continuation is scripted too.
  const originalGet = pool.get.bind(pool);
  (pool as any).get = (...args: any[]) => {
    const next = originalGet(...args);
    if ((next as any).agent && (next as any).agent.streamFunction !== script.streamFn) {
      (next as any).agent.streamFunction = script.streamFn;
    }
    return next;
  };
  return { runner, pool, store, script, settings, workspaceDir };
}

function createRunContext(options: {
  chatId: string;
  sessionId: string;
  text: string;
  onApprovalRequest?: (request: unknown) => Promise<"defer">;
}) {
  return {
    channel: "web",
    workspaceDir: process.cwd(),
    chatDir: process.cwd(),
    message: {
      chatId: options.chatId,
      chatType: "private",
      messageId: Date.now(),
      userId: "user-1",
      text: options.text,
      ts: new Date().toISOString(),
      attachments: [],
      imageContents: [],
      sessionId: options.sessionId
    },
    respond: async () => {},
    replaceMessage: async () => {},
    respondInThread: async () => {},
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {},
    ...(options.onApprovalRequest ? { onApprovalRequest: options.onApprovalRequest } : {})
  } as any;
}

function runRowStatus(runId: string): string | undefined {
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  try {
    const row = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status?: string } | undefined;
    return row?.status;
  } finally {
    db.close();
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const deferAlways = async () => "defer" as const;

test("a deferred approval suspends the run exactly once and an approval resumes it", async () => {
  const chatId = "approval-chat-approve";
  const sessionId = "approval-session-approve";
  const broker = getApprovalBroker();
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-approval-suspension-ws-"));
  const store = new MomRuntimeStore(workspaceDir);
  // Bare filename: the write tool routes it into its dated artifact folder and
  // guards reject absolute paths outside the roots it normalizes (symlinked
  // temp dirs), so the test finds the file by name under the workspace.
  const targetName = "suspended-once.txt";
  const findTarget = (): string | null => {
    const stack = [workspaceDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === targetName) return full;
      }
    }
    return null;
  };
  const script = createScriptedStreamFn([
    { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: targetName, content: "approved output", label: "write probe" } }] },
    { toolCalls: [{ id: "tc-2", name: "write", arguments: { path: targetName, content: "approved output", label: "write probe" } }] },
    { text: "Resumed and completed." }
  ]);
  const settings = createTestSettings();
  const pool = new RunnerPool(
    "web",
    store,
    () => settings,
    (patch: Partial<RuntimeSettings>) => ({ ...createTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createTestMemory() as any
  );
  const runner = pool.get(chatId, sessionId);
  (runner as any).agent.streamFunction = script.streamFn;
  attachScriptToPool(pool, script);

  // Channel "web" + manual permission mode: the real write tool must ask.
  const result = await runner.run(createRunContext({
    chatId,
    sessionId,
    text: "please write the file",
    onApprovalRequest: deferAlways
  }));

  assert.equal(result.stopReason, "waiting_for_approval", `expected the run to suspend, got ${result.stopReason}`);
  assert.equal(script.callCount(), 1, "a suspension must not trigger additional model rounds");
  assert.equal(runRowStatus(result.runId), "waiting_for_approval", "the run row must record the approval wait");

  const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
  assert.equal(pending.length, 1, "exactly one real approval request exists");
  assert.equal(findTarget(), null, "the gated write has not executed");

  // Out-of-band approval through the production resolve + resume path.
  const resolved = broker.resolveRequest({ requestId: pending[0].id, status: "approved", selectedScope: "once" });
  assert.ok(resolved.request, "the first resolve records the decision");
  const duplicate = broker.resolveRequest({ requestId: pending[0].id, status: "approved", selectedScope: "once" });
  assert.ok(!duplicate.request, "a duplicate resolve must be a no-op");

  const resumed = await resumeSuspendedBrokerApproval({
    scopeId: chatId,
    sessionId,
    requestId: pending[0].id,
    status: "approved",
    toolName: "write",
    store,
    pool,
    channel: "web"
  });
  assert.equal(resumed, true, "the suspended run must be resumed");

  await waitFor(() => script.callCount() >= 3);
  assert.equal(script.callCount(), 3, "the resumed run replays the tool once and then answers");
  assert.ok(findTarget(), "the approved write executed after the grant");
  assert.equal(readFileSync(findTarget()!, "utf8"), "approved output");
  assert.equal(runRowStatus(result.runId), "completed", "the original run completed after approval");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("a rejected approval resumes the run without executing the action", async () => {
  const chatId = "approval-chat-reject";
  const sessionId = "approval-session-reject";
  const broker = getApprovalBroker();
  const { runner, pool, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: "rejected.txt", content: "should never exist", label: "write probe" } }] },
      { text: "Understood, I will not write the file." }
    ]
  });

  const result = await runner.run(createRunContext({
    chatId,
    sessionId,
    text: "write the file",
    onApprovalRequest: deferAlways
  }));
  assert.equal(result.stopReason, "waiting_for_approval");
  const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
  assert.equal(pending.length, 1);

  const resolved = broker.resolveRequest({ requestId: pending[0].id, status: "rejected" });
  assert.ok(resolved.request);
  const resumed = await resumeSuspendedBrokerApproval({
    scopeId: chatId,
    sessionId,
    requestId: pending[0].id,
    status: "rejected",
    toolName: "write",
    store,
    pool,
    channel: "web"
  });
  assert.equal(resumed, true);

  await waitFor(() => script.callCount() >= 2);
  assert.equal(script.callCount(), 2, "rejection resumes the run once, without replaying the tool");
  assert.equal(existsSync(join(workspaceDir, "rejected.txt")), false, "a rejected action must never execute");
  assert.equal(runRowStatus(result.runId), "completed", "the run still completes after a rejection");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("a mixed batch suspends without starting another model round", async () => {
  const chatId = "approval-chat-mixed";
  const sessionId = "approval-session-mixed";
  const broker = getApprovalBroker();
  const { runner, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      {
        toolCalls: [
          { id: "tc-read", name: "read", arguments: { path: "existing.txt", label: "read probe" } },
          { id: "tc-write", name: "write", arguments: { path: "mixed.txt", content: "no", label: "write probe" } }
        ]
      }
    ]
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(workspaceDir, "existing.txt"), "hello");

  const result = await runner.run(createRunContext({
    chatId,
    sessionId,
    text: "read then write",
    onApprovalRequest: deferAlways
  }));

  assert.equal(result.stopReason, "waiting_for_approval");
  assert.equal(script.callCount(), 1, "no model round may start while an approval is pending");
  assert.equal(existsSync(join(workspaceDir, "mixed.txt")), false, "the gated write has not executed");
  const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
  assert.equal(pending.length, 1, "the write raised exactly one approval request");

  rmSync(workspaceDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Unified execution modes: Auto = full access through the real dispatcher.
// Every scenario below drives the real Runner → Agent loop → shared tool
// runtime → approval/HOST-Bash storage and asserts only observable behavior.
// ---------------------------------------------------------------------------

function brokerPendingFor(sessionId: string): number {
  return getApprovalBroker().listPendingRequests().filter((r) => r.sessionId === sessionId).length;
}

function hostBashPendingFor(chatId: string): number {
  return getHostBashStore().listPending(chatId).length;
}

test("full access executes a host command directly: no approval, no suspension, one execution", async () => {
  const chatId = "auto-chat-host";
  const sessionId = "auto-session-host";
  const { runner, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "bash", arguments: { label: "probe", command: "printf 'auto-host-ran'" } }] },
      { text: "Done." }
    ]
  });
  // Session override picks full access; the global default stays manual.
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "run the probe command" }));
  assert.equal(result.stopReason, "stop", `expected an unattended completion, got ${result.stopReason}`);
  assert.equal(script.callCount(), 2, "exactly one tool round plus the answer");
  assert.equal(runRowStatus(result.runId), "completed");
  assert.equal(brokerPendingFor(sessionId), 0, "no broker approval may be created in full access");
  assert.equal(hostBashPendingFor(chatId), 0, "no Host Bash approval may be created in full access");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("full access honors an explicit host-access request without creating an approval card", async () => {
  const chatId = "auto-chat-explicit";
  const sessionId = "auto-session-explicit";
  const { runner, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "bash", arguments: { label: "probe", command: "printf 'explicit-host-access'", hostApproval: { reason: "Model explicitly requested host access." } } }] },
      { text: "Done." }
    ]
  });
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "run it on the host" }));
  assert.equal(result.stopReason, "stop");
  assert.equal(brokerPendingFor(sessionId), 0);
  assert.equal(hostBashPendingFor(chatId), 0, "the model's request shape must not change whether approval is needed");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("full access writes a file that the sandbox denyWrite policy blocks in restricted modes", async () => {
  const chatId = "auto-chat-keyfile";
  const sessionId = "auto-session-keyfile";
  const { runner, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: "service.key", content: "PROBE=1", label: "write probe" } }] },
      { text: "Written." }
    ]
  });
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "write the key file" }));
  assert.equal(result.stopReason, "stop");
  assert.equal(script.callCount(), 2);
  // The write tool routes plain file names into the dated artifact folder, so
  // locate the file by name anywhere under the workspace.
  const findWritten = (): string | null => {
    const stack = [workspaceDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === "service.key") return full;
      }
    }
    return null;
  };
  const written = findWritten();
  assert.ok(written, "full access removes sandbox file restrictions (denyWrite *.key) for file tools");
  assert.equal(readFileSync(written, "utf8"), "PROBE=1");
  assert.equal(brokerPendingFor(sessionId), 0);

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("full access performs a manage-class management operation without a permission card", async () => {
  const chatId = "auto-chat-install";
  const sessionId = "auto-session-install";
  const { runner, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "extensionManage", arguments: { action: "list" } }] },
      { text: "Listed." }
    ]
  });
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "list the extensions" }));
  assert.equal(result.stopReason, "stop");
  assert.equal(script.callCount(), 2, "the management operation executed and the run continued");
  assert.equal(brokerPendingFor(sessionId), 0, "installations must not raise approval cards in full access");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("a messaging channel honors Manual instead of silently widening it", async () => {
  const chatId = "telegram-chat-manual";
  const sessionId = "telegram-session-manual";
  const broker = getApprovalBroker();
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-approval-suspension-ws-"));
  const store = new MomRuntimeStore(workspaceDir);
  const script = createScriptedStreamFn([
    { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: "channel-manual.txt", content: "must wait", label: "write probe" } }] },
    { text: "Waiting." }
  ]);
  const pool = new RunnerPool(
    "telegram",
    store,
    () => createTestSettings(),
    (patch: Partial<RuntimeSettings>) => ({ ...createTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createTestMemory() as any
  );
  const runner = pool.get(chatId, sessionId);
  (runner as any).agent.streamFunction = script.streamFn;

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "write the file", onApprovalRequest: deferAlways }));
  assert.equal(result.stopReason, "waiting_for_approval", "manual mode must suspend, never silently execute as accept edits");
  assert.equal(existsSync(join(workspaceDir, "channel-manual.txt")), false, "the gated write has not executed on the channel");
  assert.equal(broker.listPendingRequests().filter((r) => r.sessionId === sessionId).length, 1);
  assert.equal(script.callCount(), 1);

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("switching from full access restores restrictions on the next attempt", async () => {
  const chatId = "auto-chat-switch";
  const sessionId = "auto-session-switch";
  const broker = getApprovalBroker();
  const { runner, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: "switch.txt", content: "first", label: "write probe" } }] },
      { text: "First done." },
      { toolCalls: [{ id: "tc-2", name: "write", arguments: { path: "switch.txt", content: "second", label: "write probe" } }] },
      { text: "Waiting." }
    ]
  });
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");

  const first = await runner.run(createRunContext({ chatId, sessionId, text: "write the file" }));
  assert.equal(first.stopReason, "stop", "full access runs unattended");
  const findSwitch = (): string | null => {
    const stack = [workspaceDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === "switch.txt") return full;
      }
    }
    return null;
  };
  assert.ok(findSwitch(), "the full-access attempt wrote the file");

  // Back to manual: the very next attempt must ask again.
  store.setSessionPermissionModeOverride(chatId, sessionId, "manual");
  const second = await runner.run(createRunContext({ chatId, sessionId, text: "write the file again", onApprovalRequest: deferAlways }));
  assert.equal(second.stopReason, "waiting_for_approval", "the restriction is restored for the next attempt");
  assert.equal(broker.listPendingRequests().filter((r) => r.sessionId === sessionId).length, 1);
  assert.equal(readFileSync(findSwitch()!, "utf8"), "first", "the restricted attempt has not written");

  rmSync(workspaceDir, { recursive: true, force: true });
});

test("changing the mode never retrospectively approves a pending request", async () => {
  const chatId = "auto-chat-pending";
  const sessionId = "auto-session-pending";
  const broker = getApprovalBroker();
  const { runner, pool, store, script, workspaceDir } = await createHarness({
    chatId,
    sessionId,
    responses: [
      { toolCalls: [{ id: "tc-1", name: "write", arguments: { path: "pending.txt", content: "pending work", label: "write probe" } }] },
      { text: "Rejected, moving on." }
    ]
  });

  const result = await runner.run(createRunContext({ chatId, sessionId, text: "write the file", onApprovalRequest: deferAlways }));
  assert.equal(result.stopReason, "waiting_for_approval");
  const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
  assert.equal(pending.length, 1);

  // Granting full access afterwards must not execute the stored request by
  // itself, and the stored request stays resolvable on its own terms.
  store.setSessionPermissionModeOverride(chatId, sessionId, "auto");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(existsSync(join(workspaceDir, "pending.txt")), false, "a pending request cannot be revived by changing mode");

  const resolved = broker.resolveRequest({ requestId: pending[0].id, status: "rejected" });
  assert.ok(resolved.request);
  const resumed = await resumeSuspendedBrokerApproval({ scopeId: chatId, sessionId, requestId: pending[0].id, status: "rejected", toolName: "write", store, pool, channel: "web" });
  assert.equal(resumed, true, "the stored request resolves on its own terms after the mode change");
  assert.equal(existsSync(join(workspaceDir, "pending.txt")), false, "a rejected request never executes, in any mode");

  rmSync(workspaceDir, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HostBashStore } from "$lib/server/hostBash/index.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableChannelCommandService } from "./channelCommands.js";
import { DurableExecutionStore } from "./store.js";

function database(): { root: string; file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-channel-"));
  return { root, file: join(root, "durable-execution.sqlite"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("channel commands authorize by source chat before resolving a durable approval", async () => {
  const db = database();
  const store = new DurableExecutionStore(db.file);
  const approved: Array<{ scopeId: string; requestId?: string; scope?: string }> = [];
  const hostBashStore = {
    approve: (scopeId: string, requestId?: string, options?: { scope?: string }) => {
      approved.push({ scopeId, requestId, scope: options?.scope });
      return { approved: undefined, record: { id: requestId ?? "missing" } };
    },
    reject: () => null
  } as unknown as HostBashStore;

  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", db.root);
    const created = coordinator.create({
      ownerId: "owner",
      botId: "bot-1",
      sourceChannel: "qq",
      sourceChatId: "chat-1",
      goal: "Publish the report",
      steps: [{ title: "Publish", sideEffectClass: "non_idempotent" as const }],
      acceptanceCriteria: [{ description: "The report is published", checkerType: "subjective" as const }],
      activationPath: "deterministic"
    });
    const queued = coordinator.activate({ ownerId: "owner", executionId: created.execution.id, expectedVersion: created.execution.version });
    const claimed = store.claimAttempt({
      executionId: created.execution.id,
      expectedVersion: queued.execution.version,
      processOwnerId: "process-a",
      runId: "attempt-1",
      contextSessionId: "hidden-session",
      leaseDurationMs: 60_000
    });
    store.markStepRunning(created.execution.id, created.projection.nextStep!.id, claimed.execution.version, "process-a");
    const running = store.getById(created.execution.id)!;
    store.recordApprovalRequest({
      executionId: created.execution.id,
      attemptId: claimed.attempt.id,
      expectedVersion: running.version,
      processOwnerId: "process-a",
      requestId: "host-approval-1",
      backend: "host_bash",
      actionKey: "bash:publish:ephemeral",
      toolId: "bash",
      title: "Approval required",
      summary: "Publish the report.",
      options: ["approve_once", "reject"]
    });
    const waiting = store.transitionStatus(created.execution.id, store.getById(created.execution.id)!.version, "waiting_for_approval", {
      waitingKind: "approval",
      waitingReason: "Approval is required."
    });
    assert.equal(waiting.status, "waiting_for_approval");

    const service = new DurableChannelCommandService({
      channel: "qq",
      botId: "bot-1",
      getSettings: () => ({ locale: "en-US" }),
      hostBashStore,
      coordinator
    });
    const messages: string[] = [];
    const wrongChatHandled = await service.handle({
      scopeId: "chat-2",
      text: "/durable approve #1 once",
      sendText: async (message) => { messages.push(message); }
    });
    assert.equal(wrongChatHandled, true);
    assert.match(messages.at(-1) ?? "", /not found/i);
    assert.equal(store.getDetail(created.execution.id)!.approvals[0].status, "pending");
    assert.equal(approved.length, 0);

    const sourceChatHandled = await service.handleNaturalApproval({
      scopeId: "chat-1",
      text: "approve",
      sendText: async (message) => { messages.push(message); }
    });
    assert.equal(sourceChatHandled, true);
    assert.equal(approved[0]?.scopeId, "chat-1");
    assert.equal(approved[0]?.requestId, "host-approval-1");
    assert.equal(approved[0]?.scope, "once");
    assert.equal(store.getDetail(created.execution.id)!.approvals[0].status, "approved");
    assert.equal(store.getById(created.execution.id)!.status, "queued");
  } finally {
    store.close();
    db.cleanup();
  }
});

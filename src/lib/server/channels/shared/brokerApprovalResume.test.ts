import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { RunnerPool } from "$lib/server/agent/core/runnerPool.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { resumeSuspendedBrokerApproval } from "./brokerApprovalResume.js";

test("approval wakeup rejects a different request and a terminal run without rewriting context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-native-resume-"));
  const store = new MomRuntimeStore(directory);
  const pool = Object.create(RunnerPool.prototype) as RunnerPool;
  pool.get = () => { throw new Error("An unrelated or terminal execution must not resume"); };
  const sessionId = "native-resume-session";
  const chatId = "native-resume-chat";
  const orchestrator = getTurnOrchestrator();
  const turn = orchestrator.prepareTurn({ chatId, sessionId, message: {
    chatId, userId: "owner", messageId: 1, chatType: "private", text: "Original", ts: "1", attachments: [], imageContents: []
  } });
  try {
    store.appendContextMessage(chatId, { role: "user", content: "Original", timestamp: 1 }, sessionId);
    store.appendRuntimeEvent(chatId, { code: "PI_APPROVAL_SUSPENDED", level: "info", summary: "Waiting",
      details: { runId: turn.runId, requestId: "original-request", userId: "owner" } }, sessionId);
    orchestrator.updateRunStatus(turn.runId, "waiting_for_approval");
    const input = { scopeId: chatId, sessionId, store, pool, status: "approved" as const };
    assert.equal(await resumeSuspendedBrokerApproval({ ...input, requestId: "another-request" }), false);
    orchestrator.updateRunStatus(turn.runId, "cancelled");
    assert.equal(await resumeSuspendedBrokerApproval({ ...input, requestId: "original-request" }), false);
    assert.deepEqual(store.loadContext(chatId, sessionId), [{ role: "user", content: "Original", timestamp: 1 }]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

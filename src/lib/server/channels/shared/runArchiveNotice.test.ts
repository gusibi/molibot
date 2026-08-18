import assert from "node:assert/strict";
import test from "node:test";

import { createRunArchiveNoticeOnComplete } from "$lib/server/channels/shared/runArchiveNotice.js";

function buildHarness(options?: { shouldSend?: boolean }) {
  const sent: string[] = [];
  const seenScopeIds: string[] = [];
  const handler = createRunArchiveNoticeOnComplete({
    scopeId: "chat-1",
    shouldSend: (scopeId) => {
      seenScopeIds.push(scopeId);
      return options?.shouldSend ?? true;
    },
    sendVisibleText: async (text) => {
      sent.push(text);
    }
  });
  return { handler, sent, seenScopeIds };
}

test("run-archive notice fires for the model-fallback shape (threadEventCount > 0)", async () => {
  const { handler, sent, seenScopeIds } = buildHarness();
  await handler({ stopReason: "stop", runId: "run-42" }, { threadEventCount: 1 });
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /run-42/);
  assert.deepEqual(seenScopeIds, ["chat-1"]);
});

test("no archive notice without a thread event, a run id, or a clean stop", async () => {
  const { handler, sent } = buildHarness();
  await handler({ stopReason: "stop", runId: "run-42" }, { threadEventCount: 0 });
  await handler({ stopReason: "stop" }, { threadEventCount: 1 });
  await handler({ stopReason: "error", runId: "run-42" }, { threadEventCount: 1 });
  assert.equal(sent.length, 0);
});

test("a disabled runlog setting suppresses the notice", async () => {
  const { handler, sent } = buildHarness({ shouldSend: false });
  await handler({ stopReason: "stop", runId: "run-42" }, { threadEventCount: 1 });
  assert.equal(sent.length, 0);
});

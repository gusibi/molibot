import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { buildDesktopTaskSessionMessages } from "$lib/server/app/desktopTasks.js";
import { appendDirectEventContextMessage } from "$lib/server/channels/shared/baseRuntime.js";

test("direct one-shot text appears in the execution-linked Agent Context", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-direct-event-"));
  try {
    const store = new MomRuntimeStore(root);
    appendDirectEventContextMessage(store, "chat-1", "session-source", "Reminder fired", 1_752_643_200_000);

    const context = store.loadContext("chat-1", "session-source");
    assert.deepEqual(
      buildDesktopTaskSessionMessages(context),
      [{ role: "assistant", content: "Reminder fired", createdAt: "2025-07-16T05:20:00.000Z" }]
    );

    // pi-ai sizes the next request from the last assistant usage block and
    // reads `usage.totalTokens` without a null guard, so a delivery persisted
    // without one kills every candidate model on the Session's next turn.
    assert.deepEqual((context[0] as unknown as { usage?: unknown }).usage, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

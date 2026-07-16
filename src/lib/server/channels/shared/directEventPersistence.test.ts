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

    assert.deepEqual(
      buildDesktopTaskSessionMessages(store.loadContext("chat-1", "session-source")),
      [{ role: "assistant", content: "Reminder fired", createdAt: "2025-07-16T05:20:00.000Z" }]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

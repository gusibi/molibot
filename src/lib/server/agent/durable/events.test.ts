import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventsWatcher } from "$lib/server/agent/events.js";
import { EventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";
import { durableExecutionEventFilePath, enqueueDurableExecutionEvent } from "./events.js";

test("durable continuation events use the shared catch-up window", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-event-catchup-"));
  const leaseStore = new EventExecutionLeaseStore(":memory:");
  const executionId = "execution-offline-window";
  const eventInput = {
    executionId,
    expectedVersion: 4,
    runAt: new Date(Date.now() - 60_000)
  };
  const eventPath = enqueueDurableExecutionEvent(eventInput, root);
  const eventsDir = join(root, "system", "bots", "owner", "events");
  let dispatched = 0;
  const skipped: Array<{ filename: string; reason: string }> = [];
  const watcher = new EventsWatcher(eventsDir, async () => {
    dispatched += 1;
  }, {
    leaseStore,
    channel: "system",
    leaseScope: "system:owner",
    catchUpWindowMs: 1_000,
    onSkip: ({ filename, reason }) => skipped.push({ filename, reason })
  });

  try {
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as { type: string; status?: { state?: string } };
    assert.equal(event.type, "one-shot");
    assert.equal(event.status?.state, "skipped");
    assert.equal(dispatched, 0);
    assert.deepEqual(skipped, [{
      filename: eventPath.slice(eventPath.lastIndexOf("/") + 1),
      reason: "expired_or_invalid_time"
    }]);
    assert.equal(eventPath, durableExecutionEventFilePath(eventInput, root));
  } finally {
    watcher.stop();
    leaseStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});

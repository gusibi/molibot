import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteImageTaskStore } from "./imageTaskStore.js";
import { readPiImageUsage } from "./usage.js";
import { buildDesktopUsageSummary } from "$lib/server/app/desktopUsage.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";

test("image usage shares request attribution and survives restart without duplicate billing", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-image-usage-"));
  const database = join(directory, "tasks.sqlite");
  let store = new SqliteImageTaskStore(database);
  try {
    const params = { model: "pi|fixture|studio/image", usageScope: { channel: "telegram", botId: "bot", agentId: "agent" } };
    store.createTask("paid", "pi", "session", "Draw", params);
    store.recordResult("paid", "Ready", { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } });
    store.updateTaskProgress("paid", "failed", undefined, "Artifact save failed after generation");
    store.createTask("unknown", "pi", "session", "Draw", params);
    store.recordResult("unknown", "Ready");
    store.updateTaskProgress("unknown", "completed");
    store.createTask("other", "openai", "session", "Draw");
    const createTracker = () => new AiUsageTracker({ usageDir: join(directory, "usage"), imageUsageSource: () => readPiImageUsage(store) });
    let tracker = createTracker();
    for (let read = 0; read < 2; read++) {
      const records = tracker.list();
      assert.equal(records.length, 2);
      const paid = records.find(record => record.requestId === "paid")!;
      assert.equal(paid.estimatedCostUsd, 0.03, "local artifact failure must not erase provider usage");
      assert.equal(paid.channel, "telegram");
      assert.equal(paid.botId, "bot");
      assert.equal(paid.agentId, "agent");
      assert.equal(paid.sessionId, "session");
      assert.equal(records.find(record => record.requestId === "unknown")!.estimatedCostUsd, undefined);
      assert.equal(tracker.getStats("UTC").totals.requests, 2);
      assert.equal(tracker.getStats("UTC").totals.totalTokens, 5);
      const totals = tracker.getStats("UTC").totals;
      assert.equal(totals.imageEstimatedCostUsd, 0.03);
      assert.equal(totals.imageCostKnownRequests, 1);
      assert.equal(totals.imageCostUnknownRequests, 1);
      const desktop = buildDesktopUsageSummary(tracker.getStats("UTC"), { channel: "telegram", botId: "bot" });
      assert.equal(desktop.totals.imageEstimatedCostUsd, 0.03);
      assert.equal(desktop.totals.imageCostUnknownRequests, 1);
      assert.equal(desktop.records.items.find(record => record.requestId === "paid")?.imageEstimatedCostUsd, 0.03);
      assert.equal(buildDesktopUsageSummary(tracker.getStats("UTC"), { botId: "unrelated" }).totals.requests, 0);
      assert.equal(tracker.getSessionUsage("session").imageEstimatedCostUsd, 0.03);
      assert.equal(tracker.getSessionUsage("unrelated").imageEstimatedCostUsd, undefined);
      store.deleteTask("paid");
      assert.equal(store.getTask("paid"), null);
      assert.equal(store.getRecentTasks().length, 2);
      store.close();
      store = new SqliteImageTaskStore(database);
      tracker = createTracker();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("deleting a running image task keeps late billing but never restores its content", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-image-deletion-"));
  const database = join(directory, "tasks.sqlite");
  let store = new SqliteImageTaskStore(database);
  try {
    store.createTask("late", "pi", "session", "Private prompt", { model: "pi|fixture|studio/image" });
    store.deleteTask("late");
    store.recordResult("late", "Private response", { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } });
    store.recordArtifact("late", { index: 0, path: "private.png", mimeType: "image/png", byteLength: 20 });
    store.updateTaskProgress("late", "completed", "private.png", undefined, "https://private.invalid/image");
    store.close();
    store = new SqliteImageTaskStore(database);
    assert.equal(store.getTask("late"), null);
    assert.equal(store.getRecentTasks().length, 0);
    const facts = store.getUsageTasks()[0];
    assert.equal(facts.status, "completed");
    assert.equal(facts.usage?.cost.total, 0.03);
    assert.deepEqual(Object.keys(facts).sort(), ["id", "engine", "sessionId", "status", "createdAt", "requestParams", "usage"].sort());
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

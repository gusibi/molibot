import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiUsageTracker } from "./tracker";
import { desktopUsageFromRecords } from "$lib/server/app/desktopUsage";

test("ledger caching observes another writer, keeps caller mutations private and preserves live image usage", () => {
  const usageDir = mkdtempSync(join(tmpdir(), "molibot-analytics-"));
  let imageTokens = 7;
  try {
    const tracker = new AiUsageTracker({ usageDir, imageUsageSource: () => [{ ts: new Date().toISOString(), provider: "image", model: "image", api: "image", channel: "web", botId: "bot", inputTokens: 0, outputTokens: imageTokens, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: imageTokens }] });
    const input = { channel: "web", provider: "local", model: "fixture", agentId: "analyst", botId: "bot", inputTokens: 13 };
    tracker.record(input);
    tracker.list()[0].inputTokens = 999;
    assert.equal(tracker.list()[0].inputTokens, 13);
    imageTokens = 11;
    assert.equal(tracker.list().at(-1)?.totalTokens, 11);
    new AiUsageTracker({ usageDir }).record(input);
    assert.equal(tracker.list().length, 3);
    unlinkSync(join(usageDir, "ai-usage.jsonl"));
    assert.equal(tracker.list().length, 1);
  } finally { rmSync(usageDir, { recursive: true, force: true }); }
});

test("Desktop usage reuses timezone formatters and changes calendar windows at midnight", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ ts: `2026-10-17T${String(i % 24).padStart(2, "0")}:00:00.000Z`, provider: "local", model: "fixture", api: "chat", agentId: "analyst", channel: "web", botId: "bot", inputTokens: 13, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 20 }));
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    constructions += 1;
    return new original(...args);
  } as typeof Intl.DateTimeFormat;
  try {
    const before = desktopUsageFromRecords(rows, "Asia/Shanghai", { range: "today" }, new Date("2026-10-17T15:59:59Z"));
    const after = desktopUsageFromRecords(rows, "Asia/Shanghai", { range: "today" }, new Date("2026-10-17T16:00:00Z"));
    assert.equal(before.window.startDate, "2026-10-17");
    assert.equal(after.window.startDate, "2026-10-18");
    assert.equal(before.totals.requests + after.totals.requests, 1000);
    assert.ok(constructions <= 6, `constructed ${constructions} timezone formatters`);
  } finally { Intl.DateTimeFormat = original; }
});

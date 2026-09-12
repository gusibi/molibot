import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";

// Spec numbers from docs/requirements/session-usage-summary.md: three reported
// turns of 45,521 / 20,760 / 21,803 tokens → session total 88,084 with 8,114
// cache-read of 84,028 full input (9.66%), plus a zero-token failure and a
// foreign session that must not leak in.
test("getSessionUsage sums every token kind for one session and derives nothing", () => {
  const tracker = new AiUsageTracker({ usageDir: mkdtempSync(join(tmpdir(), "molibot-session-summary-")) });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-1", inputTokens: 40_000, cacheReadTokens: 4_000, outputTokens: 1_521, totalTokens: 45_521 });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-1", inputTokens: 18_000, cacheReadTokens: 2_000, outputTokens: 760, totalTokens: 20_760 });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-1", inputTokens: 17_914, cacheReadTokens: 2_114, outputTokens: 1_775, totalTokens: 21_803 });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-1", status: "error", errorCode: "provider_failed" });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-other", inputTokens: 9_999, outputTokens: 1, totalTokens: 10_000 });
  tracker.record({ channel: "miniapp", provider: "host", model: "text", inputTokens: 5, outputTokens: 1, totalTokens: 6 });

  const summary = tracker.getSessionUsage("s-1");
  assert.deepEqual(
    { requests: summary.requests, input: summary.inputTokens, output: summary.outputTokens, read: summary.cacheReadTokens, write: summary.cacheWriteTokens, total: summary.totalTokens },
    { requests: 4, input: 75_914, output: 4_056, read: 8_114, write: 0, total: 88_084 }
  );
  // Full input = uncached + cache read + cache write; the ratio never averages
  // per-turn percentages (45,521… turns would average 6.3%).
  const fullInput = summary.inputTokens + summary.cacheReadTokens + summary.cacheWriteTokens;
  assert.equal(fullInput, 84_028);
  assert.equal(Math.round((summary.cacheReadTokens / fullInput) * 100), 10);
  assert.ok(Math.abs(summary.cacheReadTokens / fullInput - 0.0966) < 0.0005);
  assert.ok(summary.coverageStart !== null && summary.coverageStart <= tracker.list()[tracker.list().length - 1].ts);
});

test("getSessionUsage returns zeros with null coverage for unknown or blank sessions", () => {
  const tracker = new AiUsageTracker({ usageDir: mkdtempSync(join(tmpdir(), "molibot-session-summary-empty-")) });
  tracker.record({ channel: "web", provider: "pi", model: "deepseek", sessionId: "s-1", inputTokens: 10, outputTokens: 1, totalTokens: 11 });

  const unknown = tracker.getSessionUsage("s-missing");
  assert.deepEqual({ requests: unknown.requests, totalTokens: unknown.totalTokens, coverageStart: unknown.coverageStart }, { requests: 0, totalTokens: 0, coverageStart: null });
  const blank = tracker.getSessionUsage("  ");
  assert.equal(blank.requests, 0);
  assert.equal(blank.coverageStart, null);
});

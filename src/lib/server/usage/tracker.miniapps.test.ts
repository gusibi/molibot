import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";

test("Mini App usage groups the last 30 days by app and treats legacy Mini App rows as unknown", () => {
  const tracker = new AiUsageTracker({ usageDir: mkdtempSync(join(tmpdir(), "molibot-miniapp-usage-")) });
  tracker.record({ channel: "miniapp", appId: "notes", capability: "text", status: "success", provider: "host", model: "text", inputTokens: 3, outputTokens: 2, durationMs: 20 });
  tracker.record({ channel: "miniapp", appId: "notes", capability: "transcription", status: "error", provider: "host", model: "stt", audioSeconds: 4, durationMs: 10, errorCode: "provider_failed" });
  tracker.record({ channel: "miniapp", provider: "host", model: "legacy", totalTokens: 1 });
  tracker.record({ channel: "web", provider: "host", model: "chat", totalTokens: 100 });

  assert.deepEqual(tracker.getMiniAppUsageLast30Days("UTC"), [
    { appId: "notes", requests: 2, successes: 1, failures: 1, textRequests: 1, transcriptionRequests: 1, totalTokens: 5, audioSeconds: 4, durationMs: 30 },
    { appId: "unknown", requests: 1, successes: 1, failures: 0, textRequests: 1, transcriptionRequests: 0, totalTokens: 1, audioSeconds: 0, durationMs: 0 }
  ]);
});

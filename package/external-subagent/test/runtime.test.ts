import assert from "node:assert/strict";
import test from "node:test";
import { compressOutput, ExternalSubagentRuntime } from "../src/runtime.js";
import type { ExternalSubagentProvider, ExternalSubagentRequest, ExternalSubagentResult } from "../src/types.js";

test("compressOutput compresses long output beyond maxChars", () => {
  const shortText = "hello world";
  assert.equal(compressOutput(shortText, 100), shortText);

  const longText = "A".repeat(100) + "B".repeat(100) + "C".repeat(100);
  const compressed = compressOutput(longText, 50, 20, 20);
  assert.ok(compressed.includes("characters omitted"));
  assert.ok(compressed.startsWith("A".repeat(20)));
  assert.ok(compressed.endsWith("C".repeat(20)));
});

test("ExternalSubagentRuntime handles timeouts properly", async () => {
  const runtime = new ExternalSubagentRuntime();

  // Mock slow provider
  const slowProvider: ExternalSubagentProvider = {
    id: "codex",
    isAvailable: async () => ({ available: true }),
    run: async (req: ExternalSubagentRequest): Promise<ExternalSubagentResult> => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            provider: "codex",
            output: "Finished too late",
            stopReason: "completed",
            durationMs: 500
          });
        }, 500);
        req.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve({
            provider: "codex",
            output: "",
            stopReason: "aborted",
            durationMs: 50
          });
        });
      });
    }
  };

  runtime.registerProvider(slowProvider);

  const result = await runtime.run("codex", {
    task: "slow task",
    cwd: process.cwd(),
    timeoutMs: 100
  });

  assert.equal(result.stopReason, "timeout");
  assert.ok(result.diagnostic?.includes("timed out"));
});

test("ExternalSubagentRuntime handles parent cancellation properly", async () => {
  const runtime = new ExternalSubagentRuntime();
  const controller = new AbortController();

  const mockProvider: ExternalSubagentProvider = {
    id: "claude-code",
    isAvailable: async () => ({ available: true }),
    run: async (req: ExternalSubagentRequest): Promise<ExternalSubagentResult> => {
      return new Promise((resolve) => {
        req.signal?.addEventListener("abort", () => {
          resolve({
            provider: "claude-code",
            output: "",
            stopReason: "aborted",
            durationMs: 50
          });
        });
      });
    }
  };
  runtime.registerProvider(mockProvider);

  const runPromise = runtime.run("claude-code", {
    task: "cancel task",
    cwd: process.cwd(),
    timeoutMs: 5000,
    signal: controller.signal
  });

  setTimeout(() => {
    controller.abort(new Error("User stopped run"));
  }, 50);

  const result = await runPromise;
  assert.equal(result.stopReason, "aborted");
});

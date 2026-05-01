import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const promptSource = readFileSync(join(here, "prompt.ts"), "utf8");

test("prompt source distinguishes safe local parallelism from remote fallback work", () => {
  assert.match(
    promptSource,
    /Default to parallel only for local, read-only, low-risk tool calls with no fallback or retry coordination\./
  );
  assert.match(
    promptSource,
    /Default to sequential or tightly limited parallelism for remote\/network calls, especially search or fetch steps with timeouts, retries, fallbacks, quotas, or result-normalization requirements\./
  );
  assert.match(
    promptSource,
    /If later tool calls depend on whether an earlier call succeeded, timed out, or chose a fallback path, those calls are not truly independent and must be run sequentially\./
  );
  assert.doesNotMatch(
    promptSource,
    /If multiple independent tool calls are needed, execute them in parallel; run sequentially only when one step depends on another\./
  );
});

test("prompt source no longer embeds live time guidance in the system prompt context", () => {
  assert.doesNotMatch(promptSource, /Server timezone:/);
  assert.doesNotMatch(promptSource, /For the exact current time, run: date/);
});

test("prompt source tells codebase tasks to delegate before tool budget exhaustion", () => {
  assert.match(promptSource, /If you expect more than about 8 direct read\/bash\/edit calls, delegate early/);
  assert.match(promptSource, /call `subagent` before the parent run approaches the 24-tool hard limit/);
});

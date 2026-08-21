import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExternalSubagentProbe, PROBE_TIMEOUT_MS, type ExternalSubagentProbeRuntime } from "./probe.js";

function stubRuntime(result: Record<string, unknown>, opts?: { throwErr?: Error }): ExternalSubagentProbeRuntime {
  return {
    run: async (provider, request) => {
      capturedRuns.push({ provider, request: { ...request } });
      if (opts?.throwErr) throw opts.throwErr;
      return {
        provider,
        output: "",
        stopReason: "completed",
        durationMs: 1,
        ...result
      } as never;
    }
  };
}

const capturedRuns: Array<{ provider: string; request: Record<string, unknown> }> = [];

test("probe passes only on a completed turn with non-empty output", async () => {
  capturedRuns.length = 0;
  const ok = await runExternalSubagentProbe("codex", { customPath: "/x", permissionMode: "never" }, stubRuntime({ output: "OK" }));
  assert.equal(ok.ok, true);
  assert.equal(ok.stopReason, "completed");

  // The probe must go through the shared runtime contract: real task, temp cwd,
  // bounded timeout, caller's custom path and permission mode.
  assert.equal(capturedRuns.length, 1);
  assert.equal(capturedRuns[0].provider, "codex");
  assert.equal(capturedRuns[0].request.customPath, "/x");
  assert.equal(capturedRuns[0].request.permissionMode, "never");
  assert.equal(capturedRuns[0].request.timeoutMs, PROBE_TIMEOUT_MS);
  assert.ok(String(capturedRuns[0].request.cwd).startsWith(join(tmpdir(), "molibot-subagent-probe-")));
  assert.match(String(capturedRuns[0].request.task), /connectivity test/);
});

test("probe fails when the turn errors - detection being green must not read as available", async () => {
  const failed = await runExternalSubagentProbe(
    "codex",
    undefined,
    stubRuntime({ output: "", stopReason: "error", diagnostic: "Codex subagent failure (stage: initialize; category: spawn)" })
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.stopReason, "error");
  assert.match(failed.diagnostic ?? "", /initialize/);
});

test("probe fails on not_installed and timeout stop reasons", async () => {
  const notInstalled = await runExternalSubagentProbe(
    "claude-code",
    undefined,
    stubRuntime({ output: "", stopReason: "not_installed", diagnostic: "Claude Code SDK/executable not found" })
  );
  assert.equal(notInstalled.ok, false);

  const timedOut = await runExternalSubagentProbe(
    "claude-code",
    undefined,
    stubRuntime({ output: "", stopReason: "timeout", diagnostic: "External subagent timed out" })
  );
  assert.equal(timedOut.ok, false);
});

test("probe cleans up its temp directory even when the runtime throws", async () => {
  capturedRuns.length = 0;
  await assert.rejects(
    runExternalSubagentProbe("codex", undefined, stubRuntime({}, { throwErr: new Error("boom") })),
    /boom/
  );
  const cwdUsed = String(capturedRuns[0].request.cwd);
  assert.ok(cwdUsed.startsWith(join(tmpdir(), "molibot-subagent-probe-")));
  assert.equal(existsSync(cwdUsed), false, "probe temp dir must be removed after a thrown run");
});

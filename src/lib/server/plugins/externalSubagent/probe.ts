import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type {
  ExternalSubagentProviderId,
  ExternalSubagentResult,
  ExternalSubagentRuntime
} from "#external-subagent";
import { getExternalSubagentSharedRuntime } from "./tools.js";

/** A probe must finish well inside a user's patience for a settings button. */
export const PROBE_TIMEOUT_MS = 120_000;

/**
 * The minimal honest task: it forces one full model turn through the same
 * wire protocol, auth, and provider selection the real tool uses, so a pass
 * proves execution works - not just that a binary exists on disk.
 */
const PROBE_TASK = "This is a connectivity test. Do not read or write any files. Reply with exactly: OK";

export interface ExternalSubagentProbeResult {
  ok: boolean;
  stopReason: ExternalSubagentResult["stopReason"];
  output: string;
  diagnostic?: string;
  durationMs: number;
}

export interface ExternalSubagentProbeOptions {
  customPath?: string;
  permissionMode?: string;
}

/** Injectable subset so tests can stub the runtime without spawning anything. */
export type ExternalSubagentProbeRuntime = Pick<ExternalSubagentRuntime, "run">;

/**
 * Runs one real minimal turn through the shared subagent runtime in an
 * isolated temp directory. Resolution (a binary being found) is NOT
 * availability: only a completed turn with output counts, so a probe failure
 * must surface as "unavailable" no matter what path detection said.
 */
export async function runExternalSubagentProbe(
  provider: ExternalSubagentProviderId,
  options?: ExternalSubagentProbeOptions,
  runtime: ExternalSubagentProbeRuntime = getExternalSubagentSharedRuntime()
): Promise<ExternalSubagentProbeResult> {
  const probeDir = mkdtempSync(join(os.tmpdir(), "molibot-subagent-probe-"));
  try {
    const result = await runtime.run(provider, {
      task: PROBE_TASK,
      cwd: probeDir,
      timeoutMs: PROBE_TIMEOUT_MS,
      permissionMode: options?.permissionMode as never,
      customPath: options?.customPath
    });
    return {
      ok: result.stopReason === "completed" && result.output.trim().length > 0,
      stopReason: result.stopReason,
      output: result.output.trim().slice(0, 500),
      diagnostic: result.diagnostic,
      durationMs: result.durationMs
    };
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup; the temp dir is disposable by OS policy.
    }
  }
}

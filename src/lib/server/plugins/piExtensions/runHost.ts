import type { PiExtensionStreamInput } from "$lib/server/plugins/piExtensions/toolBridge.js";
import type { AgentToolCallOutcome } from "@earendil-works/pi-agent-core";
import type { ModelOperations } from "$lib/server/agent/models/modelOperations.js";
import type { PiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/types.js";

/**
 * The capabilities a run exposes to pi extensions outside the tool path (event
 * and command handlers). Registered per run id so a handler invoked during a
 * turn can read the run's real state and call back into the shared runtime.
 */
export interface PiExtensionRunHost {
  runtime?: () => PiExtensionRuntimeSnapshot | undefined | Promise<PiExtensionRuntimeSnapshot | undefined>;
  executeTool?: (name: string, args: unknown, signal: AbortSignal | undefined, callerId: string) => Promise<AgentToolCallOutcome>;
  modelOperations?: Pick<ModelOperations, "classify" | "generateImages">;
  streamModel?: (input: PiExtensionStreamInput, emit: (event: unknown) => void, signal: AbortSignal) => Promise<unknown>;
  toolCatalog?: () => Array<{ name: string; label: string; description: string; parameters: unknown }>;
  abort?: () => void;
  compact?: () => void | Promise<void>;
}

// Bounded: a finished run's host is dropped when a new one is registered or the
// map exceeds the cap, so long-lived services cannot accumulate entries.
const hosts = new Map<string, PiExtensionRunHost>();
const MAX_RUN_HOSTS = 64;

export function registerPiExtensionRunHost(runId: string, host: PiExtensionRunHost): void {
  hosts.delete(runId);
  hosts.set(runId, host);
  while (hosts.size > MAX_RUN_HOSTS) hosts.delete(hosts.keys().next().value!);
}

export function getPiExtensionRunHost(runId: string | undefined): PiExtensionRunHost | undefined {
  return runId ? hosts.get(runId) : undefined;
}

export function clearPiExtensionRunHost(runId: string): void {
  hosts.delete(runId);
}

/** Test seam: drop every registered run host. */
export function resetPiExtensionRunHosts(): void {
  hosts.clear();
}

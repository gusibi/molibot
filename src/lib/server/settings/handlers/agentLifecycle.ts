import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "$lib/server/app/env.js";
import { decodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { snapshotAllRuntimeRuns } from "$lib/server/agent/core/runnerPool.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";
import { getDurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { channelBindingsFor } from "$lib/server/sessions/executionIdentity.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { validateAgentReferences } from "../validators.js";
import type { AgentSettings, RuntimeSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

/**
 * One typed reason an Agent cannot be deleted yet. The Desktop renders these
 * directly; a caller must never have to parse an error string to find out what
 * is blocking deletion.
 */
export type AgentBlocker =
  | { kind: "channel"; channel: string; instanceId: string }
  | { kind: "task"; file: string }
  | { kind: "run"; sessionId: string; botId?: string }
  | { kind: "approval"; requestId: string; sessionId: string }
  | { kind: "host-approval"; requestId: string; sessionId: string }
  | { kind: "durable"; sessionId: string };

export class AgentDeleteBlockedError extends Error {
  constructor(readonly blockers: AgentBlocker[]) {
    super(`Agent has active references: ${blockers.map(describeBlocker).join(", ")}`);
    this.name = "AgentDeleteBlockedError";
  }
}

export interface AgentLifecycleDeps {
  sessions: SessionStore;
  sessionLifecycle: SessionLifecycleService;
  /** Test seam; production uses the runtime data directory. */
  dataDir?: string;
}

export function agentBlockers(settings: RuntimeSettings, deps: AgentLifecycleDeps, agentId: string): AgentBlocker[] {
  const id = String(agentId ?? "").trim();
  if (!id) return [];
  const blockers: AgentBlocker[] = channelBindingsFor(settings, id).map(binding => ({ kind: "channel", ...binding }));

  const history = deps.sessionLifecycle.listAgentHistory(id);
  const sessionIds = new Set(history.flatMap(conversation => [conversation.id, decodeExternalSessionId(conversation.id)?.sessionId ?? conversation.id]));

  const events = join(deps.dataDir ?? config.dataDir, "sessions", id, "events");
  if (existsSync(events)) {
    for (const filename of readdirSync(events).filter(name => name.endsWith(".json"))) {
      let event: { target?: { kind?: string }; managed?: boolean; enabled?: boolean; status?: { state?: string }; agentId?: string; sessionId?: string };
      try { event = JSON.parse(readFileSync(join(events, filename), "utf8")); }
      catch { continue; }
      if (event.target?.kind === "project" || event.managed || event.enabled === false || ["completed", "skipped"].includes(event.status?.state ?? "")) continue;
      if (event.agentId === id || (event.sessionId && sessionIds.has(event.sessionId))) blockers.push({ kind: "task", file: filename });
    }
  }

  for (const run of snapshotAllRuntimeRuns().filter(run => run.agentId === id || sessionIds.has(run.sessionId))) {
    blockers.push({ kind: "run", sessionId: run.sessionId, ...(run.botId ? { botId: run.botId } : {}) });
  }
  for (const request of getApprovalBroker().listPendingRequests().filter(request => request.requestedBy.agentId === id || sessionIds.has(request.sessionId))) {
    blockers.push({ kind: "approval", requestId: request.id, sessionId: request.sessionId });
  }
  for (const request of getHostBashStore().listPending().filter(request => sessionIds.has(request.sessionId ?? ""))) {
    blockers.push({ kind: "host-approval", requestId: request.id, sessionId: request.sessionId ?? "" });
  }
  for (const sessionId of sessionIds) {
    if (getDurableExecutionStore().hasNonterminalForSession(sessionId)) blockers.push({ kind: "durable", sessionId });
  }
  return blockers;
}

export function describeBlocker(blocker: AgentBlocker): string {
  switch (blocker.kind) {
    case "channel": return `channel ${blocker.channel}/${blocker.instanceId}`;
    case "task": return `task ${blocker.file}`;
    case "run": return `run ${blocker.sessionId}`;
    case "durable": return `durable ${blocker.sessionId}`;
    default: return `${blocker.kind} ${blocker.requestId} (${blocker.sessionId})`;
  }
}

/**
 * Delete an Agent in three persisted states:
 *
 *   active   -> the Agent still exists in settings
 *   deleting -> recorded in `pendingAgentDeletions`; admission rejects it, history is being archived
 *   deleted  -> removed from settings and tombstoned in `deletedAgentIds`
 *
 * A failure while archiving leaves the Agent in `deleting`, so a restart can
 * resume instead of leaving a tombstoned Agent with live history.
 */
export function deleteAgent(
  runtime: SettingsAccessor & AgentLifecycleDeps,
  agentId: string
): { ok: true; agents: AgentSettings[] } {
  const id = String(agentId ?? "").trim();
  if (!id) throw new Error("agent.id is required");
  const current = runtime.getSettings();
  const known = (current.agents ?? []).some(agent => agent.id === id);
  const tombstoned = current.deletedAgentIds?.includes(id) ?? false;
  const pending = current.pendingAgentDeletions?.includes(id) ?? false;

  if (!known && tombstoned) return { ok: true, agents: current.agents ?? [] };
  if (!known && !pending) throw new Error("Agent not found");

  if (known && !pending) {
    const blockers = agentBlockers(current, runtime, id);
    if (blockers.length) throw new AgentDeleteBlockedError(blockers);
    const refError = validateAgentReferences(current, { agents: current.agents.filter(agent => agent.id !== id) });
    if (refError) throw new Error(refError);
    runtime.updateSettings({ pendingAgentDeletions: [...new Set([...(current.pendingAgentDeletions ?? []), id])] });
  }

  for (const result of runtime.sessionLifecycle.archiveAgentHistory(id)) {
    if (result.status === "failed" || (result.status === "skipped" && result.reason !== "not_applicable")) {
      throw new Error(`Agent deletion is incomplete; Session archive requires retry: ${result.conversationId}`);
    }
  }

  const latest = runtime.getSettings();
  const updated = runtime.updateSettings({
    agents: (latest.agents ?? []).filter(agent => agent.id !== id),
    deletedAgentIds: [...new Set([...(latest.deletedAgentIds ?? []), id])],
    pendingAgentDeletions: (latest.pendingAgentDeletions ?? []).filter(pendingId => pendingId !== id)
  });
  return { ok: true, agents: updated.agents ?? [] };
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "$lib/server/app/env.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import { decodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { snapshotAllRuntimeRuns } from "$lib/server/agent/core/runnerPool.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";
import { getDurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { sanitizeAgents, sanitizeSingleAgent } from "../sanitize.js";
import { validateAgentReferences } from "../validators.js";
import type { AgentSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function listAgents(runtime: SettingsAccessor): AgentSettings[] {
  return runtime.getSettings().agents ?? [];
}

function mergeAgentInput(agents: AgentSettings[], raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;
  const existing = agents.find(agent => agent.id === String(input.id ?? "").trim());
  return { ...existing, ...input };
}

export function replaceAgents(runtime: SettingsAccessor, raw: unknown): AgentSettings[] {
  const current = runtime.getSettings();
  const agents = sanitizeAgents(Array.isArray(raw) ? raw.map(row => mergeAgentInput(current.agents, row)) : raw);
  if (runtime.getSettings().agents.some(agent => !agents.some(next => next.id === agent.id))) throw new Error("Delete Agents through the Agent lifecycle endpoint");
  const refError = validateAgentReferences(runtime.getSettings(), { agents });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ agents });
  return updated.agents ?? [];
}

export function upsertAgent(runtime: SettingsAccessor, raw: unknown, previousIdRaw?: unknown): AgentSettings {
  const current = runtime.getSettings();
  const agent = sanitizeSingleAgent(mergeAgentInput(current.agents, raw));
  const previousId = previousIdRaw === undefined ? agent.id : String(previousIdRaw ?? "").trim();
  if (previousId && previousId !== agent.id) throw new Error("Agent ID is immutable; edit the display name instead.");
  if (!/^[a-zA-Z0-9._-]+$/.test(agent.id) || agent.id === "." || agent.id === "..") throw new Error("Invalid Agent ID");
  const toRemove = new Set<string>();
  toRemove.add(agent.id);
  if (previousId) toRemove.add(previousId);
  const existing = (current.agents ?? []).filter((a) => !toRemove.has(a.id));
  const next: AgentSettings[] = [...existing, agent];
  const refError = validateAgentReferences(current, { agents: next });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ agents: next });
  const saved = (updated.agents ?? []).find((a) => a.id === agent.id);
  if (!saved) throw new Error(`Agent ${agent.id} was not persisted`);
  return saved;
}

export function deleteAgent(runtime: SettingsAccessor & { sessions: SessionStore; sessionLifecycle: SessionLifecycleService }, agentId: string): { ok: true; agents: AgentSettings[] } {
  const id = String(agentId ?? "").trim();
  if (!id) throw new Error("agent.id is required");
  const current = runtime.getSettings();
  if (!(current.agents ?? []).some((a) => a.id === id) && !current.deletedAgentIds?.includes(id)) throw new Error("Agent not found");
  const owned = runtime.sessionLifecycle.listAgentHistory(id);
  const sessionIds = new Set(owned.flatMap(conversation => [conversation.id, decodeExternalSessionId(conversation.id)?.sessionId ?? conversation.id]));
  const references: string[] = [];
  const events = join(config.dataDir, "sessions", id, "events");
  if (existsSync(events)) for (const filename of readdirSync(events).filter(name => name.endsWith(".json"))) {
    const event = JSON.parse(readFileSync(join(events, filename), "utf8"));
    if (event.target?.kind === "project" || event.managed || event.enabled === false || ["completed", "skipped"].includes(event.status?.state)) continue;
    if (event.agentId === id || sessionIds.has(event.sessionId)) references.push(filename);
  }
  if (references.length) throw new Error(`Agent is referenced by scheduled tasks: ${references.join(", ")}`);
  const runs = snapshotAllRuntimeRuns().filter(run => run.agentId === id || sessionIds.has(run.sessionId));
  const approvals = getApprovalBroker().listPendingRequests().filter(request => request.requestedBy.agentId === id || sessionIds.has(request.sessionId));
  const hostApprovals = getHostBashStore().listPending().filter(request => sessionIds.has(request.sessionId ?? ""));
  const tasks = [...sessionIds].filter(sessionId => getDurableExecutionStore().hasNonterminalForSession(sessionId));
  if (runs.length || approvals.length || hostApprovals.length || tasks.length) {
    throw new Error(`Agent has active work or pending approvals: ${[...runs.map(run => run.sessionId), ...approvals.map(request => request.id), ...hostApprovals.map(request => request.id), ...tasks].join(", ")}`);
  }
  const remaining = (current.agents ?? []).filter((a) => a.id !== id);
  const refError = validateAgentReferences(current, { agents: remaining });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ agents: remaining, deletedAgentIds: [...new Set([...(current.deletedAgentIds ?? []), id])] });
  for (const result of runtime.sessionLifecycle.archiveAgentHistory(id)) {
    if (result.status === "failed" || (result.status === "skipped" && result.reason !== "not_applicable")) throw new Error(`Agent removed; Session archive requires retry: ${result.conversationId}`);
  }
  return { ok: true, agents: updated.agents ?? [] };
}

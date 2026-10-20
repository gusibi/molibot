import { sanitizeAgents, sanitizeSingleAgent } from "../sanitize.js";
import { validateAgentReferences } from "../validators.js";
import type { AgentSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";
import { deleteAgent as deleteAgentLifecycle, type AgentLifecycleDeps } from "./agentLifecycle.js";

export { AgentDeleteBlockedError, agentBlockers, type AgentBlocker } from "./agentLifecycle.js";

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

export function deleteAgent(
  runtime: SettingsAccessor & AgentLifecycleDeps,
  agentId: string
): { ok: true; agents: AgentSettings[] } {
  return deleteAgentLifecycle(runtime, agentId);
}

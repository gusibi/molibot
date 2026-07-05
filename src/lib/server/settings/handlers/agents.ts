import { sanitizeAgents, sanitizeSingleAgent } from "../sanitize.js";
import { validateAgentReferences } from "../validators.js";
import type { AgentSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function listAgents(runtime: SettingsAccessor): AgentSettings[] {
  return runtime.getSettings().agents ?? [];
}

export function replaceAgents(runtime: SettingsAccessor, raw: unknown): AgentSettings[] {
  const agents = sanitizeAgents(raw);
  const refError = validateAgentReferences(runtime.getSettings(), { agents });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ agents });
  return updated.agents ?? [];
}

export function upsertAgent(runtime: SettingsAccessor, raw: unknown, previousIdRaw?: unknown): AgentSettings {
  const agent = sanitizeSingleAgent(raw);
  const previousId = previousIdRaw === undefined ? agent.id : String(previousIdRaw ?? "").trim();
  const current = runtime.getSettings();
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

export function deleteAgent(runtime: SettingsAccessor, agentId: string): { ok: true; agents: AgentSettings[] } {
  const id = String(agentId ?? "").trim();
  if (!id) throw new Error("agent.id is required");
  const current = runtime.getSettings();
  if (!(current.agents ?? []).some((a) => a.id === id)) throw new Error("Agent not found");
  const remaining = (current.agents ?? []).filter((a) => a.id !== id);
  const refError = validateAgentReferences(current, { agents: remaining });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ agents: remaining });
  return { ok: true, agents: updated.agents ?? [] };
}

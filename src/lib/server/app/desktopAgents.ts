import { sanitizeAgentModelRouting, type AgentSettings, type RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopAgentItem, DesktopAgentsSummary, DesktopAgentSaveRequest } from "$lib/shared/desktop";

const ROUTING_KEYS = ["textModelKey", "visionModelKey", "sttModelKey"] as const;

function countModelOverrides(agent: AgentSettings): number {
  const routing = agent.modelRouting;
  if (!routing) return 0;
  return ROUTING_KEYS.reduce((total, key) => {
    const value = routing[key];
    return total + (typeof value === "string" && value.trim().length > 0 ? 1 : 0);
  }, 0);
}

/**
 * Maps an agent config into a Desktop view. Agents carry no provider secrets,
 * so the mapper projects only stable, display-relevant fields — id, name,
 * description, enabled, the optional sandbox override, and a count of
 * per-agent model-routing overrides — rather than handing the WebView the full
 * settings object.
 */
export function buildDesktopAgentItem(agent: AgentSettings): DesktopAgentItem {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    description: agent.description ?? "",
    enabled: agent.enabled !== false,
    sandboxEnabled: agent.sandboxEnabled === undefined ? null : Boolean(agent.sandboxEnabled),
    modelOverrides: countModelOverrides(agent),
    modelRouting: {
      textModelKey: agent.modelRouting?.textModelKey ?? "",
      visionModelKey: agent.modelRouting?.visionModelKey ?? "",
      sttModelKey: agent.modelRouting?.sttModelKey ?? ""
    }
  };
}

export function saveDesktopAgent(settings: RuntimeSettings, request: DesktopAgentSaveRequest): AgentSettings[] {
  const id = String(request.id ?? "").trim();
  const previousId = String(request.previousId ?? "").trim();
  if (!id) throw new Error("agentId is required");
  const agent: AgentSettings = {
    id,
    name: String(request.name ?? "").trim() || id,
    description: String(request.description ?? "").trim(),
    enabled: request.enabled !== false,
    sandboxEnabled: request.sandboxEnabled === null ? undefined : Boolean(request.sandboxEnabled),
    modelRouting: sanitizeAgentModelRouting(request.modelRouting)
  };
  return [...settings.agents.filter((item) => item.id !== id && item.id !== previousId), agent];
}

export function deleteDesktopAgent(settings: RuntimeSettings, agentId: string): AgentSettings[] {
  const id = String(agentId ?? "").trim();
  if (!id) throw new Error("agentId is required");
  const referenced = Object.values(settings.channels ?? {}).some((channel) =>
    Array.isArray(channel?.instances) && channel.instances.some((instance) => String(instance.agentId ?? "").trim() === id)
  );
  if (referenced) throw new Error("This agent is still linked to one or more channel instances.");
  if (!settings.agents.some((agent) => agent.id === id)) throw new Error("Agent not found");
  return settings.agents.filter((agent) => agent.id !== id);
}

export function buildDesktopAgentsSummary(settings: RuntimeSettings): DesktopAgentsSummary {
  const agents = Array.isArray(settings.agents) ? settings.agents : [];
  const items = agents.map(buildDesktopAgentItem);
  return {
    items,
    counts: {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length
    }
  };
}

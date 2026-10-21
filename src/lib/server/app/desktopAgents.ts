import { type AgentSettings, type RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopAgentItem, DesktopAgentsSummary } from "$lib/shared/desktop";
import { sortAgentNavigation } from "$lib/shared/agentNavigation";

const ROUTING_KEYS = ["textModelKey", "sttModelKey"] as const;

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
export function buildDesktopAgentItem(agent: AgentSettings, canExecute = agent.enabled !== false): DesktopAgentItem {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    description: agent.description ?? "",
    enabled: agent.enabled !== false,
    canExecute,
    visible: agent.visible !== false,
    avatar: agent.avatar ?? "",
    shareOwnerMemory: agent.shareOwnerMemory !== false,
    disabledSkillPaths: agent.disabledSkillPaths ?? [],
    disabledTools: agent.disabledTools ?? [],
    permissionMode: agent.permissionMode ?? null,
    modelOverrides: countModelOverrides(agent),
    modelRouting: {
      textModelKey: agent.modelRouting?.textModelKey ?? "",
      sttModelKey: agent.modelRouting?.sttModelKey ?? ""
    }
  };
}

export function buildDesktopAgentsSummary(
  settings: RuntimeSettings,
  latestConversationAtByAgent: Record<string, number> = {}
): DesktopAgentsSummary {
  const agents = Array.isArray(settings.agents) ? settings.agents : [];
  const pending = new Set(settings.pendingAgentDeletions ?? []);
  const items = agents.map(agent => buildDesktopAgentItem(agent, agent.enabled !== false && !pending.has(agent.id)));
  // One ordering rule, shared with any other surface that lists Agents: default
  // first, then most recent conversation, then the collator.
  const sorted = sortAgentNavigation(items, latestConversationAtByAgent, settings.defaultAgentId);
  return {
    defaultAgentId: settings.defaultAgentId,
    deletedAgentIds: settings.deletedAgentIds,
    items: sorted,
    counts: {
      total: sorted.length,
      enabled: sorted.filter((item) => item.enabled).length
    }
  };
}

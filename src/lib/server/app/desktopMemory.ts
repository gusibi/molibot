import { agentNamespace, ownerNamespace } from "$lib/server/memory/namespaces";
import type { MemoryRecord } from "$lib/server/memory/types";
import { DEFAULT_AGENT_ID, type RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryGateway } from "$lib/server/memory/gateway";
import type { DesktopHomeMemoryReview } from "$lib/shared/desktop";
import type { MemoryBackendCapabilities } from "$lib/server/memory/types";
import type { DesktopMemorySummary } from "$lib/shared/desktop";

export interface DesktopMemoryRuntimeState {
  enabled: boolean;
  capabilities: MemoryBackendCapabilities | null;
  embedding?: { providerId: string; providerName: string; model: string } | null;
}

/**
 * Builds the Desktop memory summary from the memory backend config plus the
 * live runtime state. Memory records themselves carry user content, so they are
 * never read here — the section only surfaces the backend name, the
 * config/runtime enabled flags, and the backend capability flags.
 */
export function buildDesktopMemorySummary(
  settings: RuntimeSettings,
  runtime: DesktopMemoryRuntimeState
): DesktopMemorySummary {
  const config = settings.plugins?.memory ?? { enabled: false, backend: "" };
  const caps = runtime.capabilities;
  return {
    enabled: runtime.enabled === true,
    configEnabled: config.enabled === true,
    backend: config.backend ?? "",
    embedding: runtime.embedding ?? null,
    capabilities: {
      hybridSearch: caps?.supportsHybridSearch === true,
      vectorSearch: caps?.supportsVectorSearch === true,
      incrementalFlush: caps?.supportsIncrementalFlush === true,
      layeredMemory: caps?.supportsLayeredMemory === true,
      domains: caps?.supportsDomains === true,
      versioning: caps?.supportsVersioning === true,
      candidates: caps?.supportsCandidates === true
    }
  };
}

/** Agent settings show Agent facts and optionally shared owner records. */
export function desktopAgentMemoryScope(settings: RuntimeSettings, agentId: string) {
  const agent = settings.agents.find(item => item.id === agentId);
  if (!agent || settings.deletedAgentIds?.includes(agentId)) throw new Error("Agent not found");
  return { agentId, botId: agentId, channel: "web", externalUserId: "desktop-agent-memory", ownerId: "owner", shareOwner: agent.shareOwnerMemory !== false };
}

export function desktopAgentMemoryRecords(scope: ReturnType<typeof desktopAgentMemoryScope>, items: MemoryRecord[]): MemoryRecord[] {
  return items.filter(item => item.namespace === agentNamespace(scope.agentId) || (scope.shareOwner && item.namespace === ownerNamespace(scope.ownerId)));
}

/** The home uses the Agent's existing memory scope; Project and conversation candidates stay in the memory center. */
export function readDesktopHomeMemoryReview(
  settings: RuntimeSettings,
  memory: Pick<MemoryGateway, "listReviewCandidates">
): DesktopHomeMemoryReview {
  try {
    const scope = desktopAgentMemoryScope(settings, settings.defaultAgentId || DEFAULT_AGENT_ID);
    const namespaces = [agentNamespace(scope.agentId), ...(scope.shareOwner ? [ownerNamespace(scope.ownerId)] : [])];
    const candidates = memory.listReviewCandidates(namespaces, 11);
    const skills = memory.listReviewCandidates(namespaces, 11, true);
    return {
      ...(skills.length ? { skillDraftCount: Math.min(10, skills.length), skillDraftHasMore: skills.length > 10 } : {}),
      items: candidates.slice(0, 10).map(({ id, status, namespace, domain, type, subject, value, confidence, reason, sources, createdAt, updatedAt, supersedesMemoryId, disputesMemoryId }) => ({
        id, status, namespace, domain, type, subject, value, confidence, reason,
        sources: sources.slice(0, 3), createdAt, updatedAt,
        ...(supersedesMemoryId ? { supersedesMemoryId } : {}), ...(disputesMemoryId ? { disputesMemoryId } : {})
      })),
      hasMore: candidates.length > 10,
      unavailable: false
    };
  } catch {
    return { items: [], hasMore: false, unavailable: true };
  }
}

/** Resolve only the candidate's declared predecessors inside the saved Agent scope. */
export async function readDesktopMemoryComparison(
  settings: RuntimeSettings,
  memory: Pick<MemoryGateway, 'isEnabled' | 'getCandidate' | 'getForGovernance'>,
  input: { id: string; expectedUpdatedAt?: string; agentId?: string }
): Promise<import('$lib/shared/desktop').DesktopMemoryComparison> {
  if (!memory.isEnabled()) throw new Error('Memory is disabled');
  const scope = desktopAgentMemoryScope(settings, input.agentId || settings.defaultAgentId || DEFAULT_AGENT_ID);
  const candidate = memory.getCandidate(input.id);
  const namespaces = [agentNamespace(scope.agentId), ...(scope.shareOwner ? [ownerNamespace(scope.ownerId)] : [])];
  if (!candidate || candidate.status !== 'pending' || candidate.skillDraftSuggestion || !namespaces.includes(candidate.namespace)
    || !input.expectedUpdatedAt || candidate.updatedAt !== input.expectedUpdatedAt) throw new Error('Candidate changed or is unavailable');
  const originals: import('$lib/shared/desktop').DesktopMemoryComparison['originals'] = [];
  for (const [relation, id] of [['replaces', candidate.supersedesMemoryId], ['disputes', candidate.disputesMemoryId]] as const) {
    if (!id) continue;
    const original = await memory.getForGovernance(scope, id);
    const available = Boolean(original && !original.privacySuppressed && original.namespace === candidate.namespace && namespaces.includes(original.namespace));
    originals.push({ relation, available, ...(available && original ? { content: original.content, updatedAt: original.updatedAt } : {}) });
  }
  const current = memory.getCandidate(input.id);
  if (!current || current.status !== 'pending' || current.updatedAt !== candidate.updatedAt) throw new Error('Candidate changed during comparison');
  return { candidateId: candidate.id, candidateUpdatedAt: candidate.updatedAt, originals };
}

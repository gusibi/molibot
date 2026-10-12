import { agentNamespace, ownerNamespace } from "$lib/server/memory/namespaces";
import type { MemoryRecord } from "$lib/server/memory/types";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryBackendCapabilities } from "$lib/server/memory/types";
import type { DesktopMemorySummary } from "$lib/shared/desktop";

export interface DesktopMemoryRuntimeState {
  enabled: boolean;
  capabilities: MemoryBackendCapabilities | null;
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
  const config = settings.plugins?.memory ?? { enabled: false, backend: "", embeddingProviderId: "", embeddingModel: "" };
  const caps = runtime.capabilities;
  return {
    enabled: runtime.enabled === true,
    configEnabled: config.enabled === true,
    backend: config.backend ?? "",
    embeddingProviderId: config.embeddingProviderId ?? "",
    embeddingModel: config.embeddingModel ?? "",
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

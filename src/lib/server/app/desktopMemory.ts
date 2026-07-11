import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryBackendCapabilities } from "$lib/server/memory/types";
import type { DesktopMemorySummary } from "$lib/shared/desktop";

export interface DesktopMemoryRuntimeState {
  enabled: boolean;
  capabilities: MemoryBackendCapabilities;
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

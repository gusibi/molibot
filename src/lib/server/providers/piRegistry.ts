import type { KnownProvider, Model } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";
import { FileCredentialStore } from "$lib/server/agent/identity/credentialStore.js";

const models = builtinModels({
  credentials: new FileCredentialStore(resolveAuthFilePath())
});

export interface PiProviderDescriptor {
  id: KnownProvider;
  name: string;
  models: readonly Model<any>[];
}

export function getPiModels() {
  return models;
}

/** Chat-capable settings candidates; other model types remain in getPiModels(). */
export function getPiProviders(): readonly PiProviderDescriptor[] {
  return models.getProviders().map((provider) => ({
    id: provider.id as KnownProvider,
    name: provider.name,
    models: models.getModels(provider.id)
  })).filter((provider) => provider.models.length > 0);
}

export function isPiProvider(value: string): value is KnownProvider {
  return models.getModels(value).length > 0;
}

/**
 * Provider ids pi has renamed. Settings written before a rename keep the old id,
 * so they are translated to the current id when they are read.
 */
const LEGACY_PROVIDER_ALIASES: Record<string, string> = {
  // pi 1.0.3 renamed the Azure provider (`azure-openai-responses` -> `azure`).
  "azure-openai-responses": "azure"
};

/** Translates a provider id written before a pi rename to the id pi uses now. */
export function normalizePiProviderId(value: string): string {
  const raw = String(value ?? "").trim();
  return LEGACY_PROVIDER_ALIASES[raw] ?? raw;
}

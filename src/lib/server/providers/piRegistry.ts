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

export function getPiProviders(): readonly PiProviderDescriptor[] {
  return models.getProviders().map((provider) => ({
    id: provider.id as KnownProvider,
    name: provider.name,
    models: models.getModels(provider.id)
  }));
}

export function isPiProvider(value: string): value is KnownProvider {
  return models.getProvider(value) !== undefined;
}

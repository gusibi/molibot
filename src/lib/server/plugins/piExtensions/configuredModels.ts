import type { Model, Models } from "@earendil-works/pi-ai";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { isCustomProviderUsable, modelSupportsUseCase, resolveCustomModel } from "$lib/server/agent/routing/modelRouting.js";
import type { PiExtensionModelCatalog, PiExtensionModelRef } from "./types.js";

function customModel(settings: RuntimeSettings, providerId: string, modelId: string): Model<any> | undefined {
  const provider = settings.customProviders.find(provider => provider.id === providerId && provider.enabled !== false && isCustomProviderUsable(provider));
  const model = provider?.models.find(model => model.id === modelId && model.enabled !== false && modelSupportsUseCase(model, "text"));
  return provider && model ? resolveCustomModel(provider, model.id, settings.maxOutputTokens) : undefined;
}

/** Resolve host-owned settings; extension-supplied endpoints and credentials are never used. */
export function resolvePiExtensionChatModel(settings: RuntimeSettings, models: Models, ref: Pick<PiExtensionModelRef, "provider" | "id">): Model<any> | undefined {
  return models.getModel(ref.provider, ref.id) ?? customModel(settings, ref.provider, ref.id);
}

/** Only configured providers appear usable in the native registry's host bridge. */
export function configuredPiExtensionChatModels(settings: RuntimeSettings, models: Models, catalog: PiExtensionModelCatalog): Model<any>[] {
  const configured = models.getModels().filter(model => {
    const provider = settings.customProviders.find(provider => provider.id === model.provider);
    return catalog.providerAuth[model.provider] && provider?.enabled !== false && provider?.models.find(row => row.id === model.id)?.enabled !== false;
  });
  const custom = settings.customProviders.flatMap(provider => provider.models.flatMap(model => {
    const resolved = customModel(settings, provider.id, model.id);
    return resolved ? [resolved] : [];
  }));
  return [...new Map([...configured, ...custom].map(model => [`${model.provider}\0${model.id}`, model])).values()];
}

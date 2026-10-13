import type { Models } from "@earendil-works/pi-ai";
import type { PiExtensionModelCatalog, PiExtensionModelRef } from "$lib/server/plugins/piExtensions/types.js";

function ref(model: { provider: string; id: string; name?: string; api?: string }): PiExtensionModelRef {
  return { provider: model.provider, id: model.id, name: model.name ?? model.id, api: model.api ?? "" };
}

/**
 * Build the extension-facing model catalog from the shared `Models` facade.
 *
 * Only identity is exposed (`provider`/`id`/`name`/`api`) — never a Provider
 * object or a credential. Availability is the provider having configured
 * credentials; it says nothing about whether a given call is permitted. It is
 * resolved per invocation so a credential added mid-session is reflected, and
 * mirrors how the shared `ModelOperations` catalog resolves availability.
 */
export function createPiExtensionModelCatalog(models: Models): () => Promise<PiExtensionModelCatalog> {
  return async function catalog(): Promise<PiExtensionModelCatalog> {
    const chat = models.getModels().map(ref);
    const classifier = models.getModelsOfType("classifier").map(ref);
    const image = models.getModelsOfType("image").map(ref);
    const providerAuth: Record<string, boolean> = {};
    const providerOAuth: Record<string, boolean> = {};
    await Promise.all([...new Set([...chat, ...classifier, ...image].map((model) => model.provider))].map(async (provider) => {
      try { const auth = await models.checkAuth(provider); providerAuth[provider] = auth !== undefined; providerOAuth[provider] = auth?.type === "oauth"; }
      catch { providerAuth[provider] = false; }
    }));
    return { chat, classifier, image, providerAuth, providerOAuth };
  };
}

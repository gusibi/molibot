import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getPiProviders } from "$lib/server/providers/piRegistry.js";
import type { CustomProviderConfig } from "$lib/server/settings";

export const GET: RequestHandler = async () => {
  const piProviders = getPiProviders();
  const providers = piProviders.map((provider) => ({
    id: provider.id,
    name: provider.name
  }));

  const providerModels = Object.fromEntries(
    piProviders.map((provider) => [provider.id, provider.models.map((model) => model.id)])
  );

  const customTemplate: CustomProviderConfig = {
    id: "",
    name: "",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    models: [
      {
        id: "",
        tags: ["text"],
        enabled: true,
        supportedRoles: ["system", "user", "assistant", "tool"]
      }
    ],
    defaultModel: "",
    path: "/v1/chat/completions"
  };

  const capabilityTags = ["text", "vision", "stt", "tts", "tool"];

  return json({
    ok: true,
    providers,
    providerModels,
    customTemplate,
    capabilityTags
  });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getModels } from "@mariozechner/pi-ai";
import { KNOWN_PROVIDER_LIST, type CustomProviderConfig } from "$lib/server/config";

export const GET: RequestHandler = async () => {
  const providers = KNOWN_PROVIDER_LIST.map((provider) => ({
    id: provider,
    name: provider
  }));

  const providerModels = Object.fromEntries(
    KNOWN_PROVIDER_LIST.map((provider) => [provider, getModels(provider).map((m) => m.id)])
  );

  const customTemplate: CustomProviderConfig = {
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    models: [
      {
        id: "",
        tags: ["text"],
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

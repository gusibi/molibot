import { getPiCatalogModels } from "$lib/server/providers/piRuntime.js";
import { ModelRegistryService } from "$lib/server/providers/modelRegistry.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { KNOWN_PROVIDER_LIST } from "$lib/server/settings/schema.js";
import type {
  DesktopImageRecognitionModel,
  DesktopImageRecognitionSummary,
  DesktopImageRecognitionUpdateRequest
} from "$lib/shared/desktop.js";

const ENGINE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL_KEY = /^(pi|custom)\|[^|]+\|.+$/;

export function listImageRecognitionModels(settings: RuntimeSettings): DesktopImageRecognitionModel[] {
  const registry = ModelRegistryService.getInstance();
  const builtin = KNOWN_PROVIDER_LIST.flatMap((providerId) =>
    getPiCatalogModels(providerId)
      .filter((model) => Array.isArray(model.input) && model.input.includes("image"))
      .map((model) => ({
        key: `pi|${providerId}|${model.id}`,
        label: `${providerId} / ${model.name || model.id}`,
        providerId,
        modelId: model.id,
        verification: "passed" as const
      }))
  );
  const custom = settings.customProviders
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) => provider.models
      .filter((model) => model.enabled !== false && model.tags?.includes("vision"))
      .map((model) => {
        let verification = model.verification?.vision;
        if (!verification || verification === "untested") {
          const inferred = registry.inferModelCapabilities(model.id);
          if (inferred.matched && inferred.vision) {
            verification = "passed";
          } else {
            verification = "untested";
          }
        }
        return {
          key: `custom|${provider.id}|${model.id}`,
          label: `${provider.name || provider.id} / ${model.alias || model.id}`,
          providerId: provider.id,
          modelId: model.id,
          verification
        };
      })
    );
  return [...custom, ...builtin];
}

export function buildDesktopImageRecognitionSummary(
  settings: RuntimeSettings
): DesktopImageRecognitionSummary {
  const config = settings.imageRecognition;
  return {
    enabled: config.enabled,
    defaultEngine: config.defaultEngine,
    engines: config.engineOrder.flatMap((id) => {
      const engine = config.engines[id];
      return engine ? [{ id, enabled: engine.enabled, name: engine.name ?? "", modelKey: engine.modelKey }] : [];
    }),
    models: listImageRecognitionModels(settings),
    adapterTypes: ["api"],
    plannedAdapterTypes: ["cli"]
  };
}

export function isDesktopImageRecognitionUpdateRequest(
  value: unknown
): value is DesktopImageRecognitionUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean" || typeof input.defaultEngine !== "string" || !Array.isArray(input.engines)) return false;
  const ids = new Set<string>();
  for (const raw of input.engines) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const engine = raw as Record<string, unknown>;
    if (typeof engine.id !== "string" || engine.id === "auto" || !ENGINE_ID.test(engine.id) || ids.has(engine.id)) return false;
    if (typeof engine.enabled !== "boolean" || typeof engine.name !== "string" || typeof engine.modelKey !== "string" || !MODEL_KEY.test(engine.modelKey)) return false;
    ids.add(engine.id);
  }
  return input.defaultEngine === "auto" || ids.has(input.defaultEngine);
}

export function buildImageRecognitionSettingsInput(
  request: DesktopImageRecognitionUpdateRequest
): RuntimeSettings["imageRecognition"] {
  return {
    enabled: request.enabled,
    defaultEngine: request.defaultEngine,
    engineOrder: request.engines.map((engine) => engine.id),
    engines: Object.fromEntries(request.engines.map(({ id, enabled, name, modelKey }) => [id, {
      enabled,
      ...(name.trim() ? { name: name.trim() } : {}),
      modelKey
    }]))
  };
}

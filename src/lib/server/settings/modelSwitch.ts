import type { RuntimeSettings } from "./index.js";
import { isKnownProvider } from "./index.js";

export type ModelRoute = "text" | "vision" | "stt" | "tts";

export interface ModelOption {
  key: string;
  label: string;
  patch: Partial<RuntimeSettings>;
}

export interface ModelSwitchResult {
  route: ModelRoute;
  selector: string;
  selected: ModelOption;
  settings: RuntimeSettings;
}

export function resolveBuiltInProviderDefaultModel(
  settings: RuntimeSettings,
  providerId: string,
  preferredModelId: string
): string {
  const configured = settings.customProviders.find((provider) => provider.id === providerId && isKnownProvider(provider.id));
  if (!configured) return preferredModelId;
  const modelIds = configured.models.map((model) => model.id.trim()).filter(Boolean);
  if (modelIds.length === 0) return preferredModelId;
  if (preferredModelId && modelIds.includes(preferredModelId)) return preferredModelId;
  if (configured.defaultModel?.trim() && modelIds.includes(configured.defaultModel.trim())) {
    return configured.defaultModel.trim();
  }
  return modelIds[0] ?? preferredModelId;
}

function routePatchKey(route: ModelRoute): keyof RuntimeSettings["modelRouting"] {
  return route === "text"
    ? "textModelKey"
    : route === "vision"
      ? "visionModelKey"
      : route === "stt"
        ? "sttModelKey"
        : "ttsModelKey";
}

export function parseModelRoute(value: string): ModelRoute | null {
  if (value === "text" || value === "vision" || value === "stt" || value === "tts") return value;
  return null;
}

export function currentModelKey(settings: RuntimeSettings, route: ModelRoute): string {
  const routed = route === "text"
    ? settings.modelRouting.textModelKey?.trim()
    : route === "vision"
      ? settings.modelRouting.visionModelKey?.trim()
      : route === "stt"
        ? settings.modelRouting.sttModelKey?.trim()
        : settings.modelRouting.ttsModelKey?.trim();
  if (routed) return routed;
  if (route !== "text") return "";
  if (settings.providerMode === "custom") {
    const enabledProviders = settings.customProviders.filter((p) => p.enabled !== false);
    const id = settings.defaultCustomProviderId || enabledProviders[0]?.id || "";
    const provider = enabledProviders.find((p) => p.id === id) ?? enabledProviders[0];
    const modelIds = (provider?.models ?? []).map((m) => m.id).filter(Boolean);
    const model = provider?.defaultModel || modelIds[0] || "";
    return id ? `custom|${id}|${model}` : `pi|${settings.piModelProvider}|${settings.piModelName}`;
  }
  const resolvedBuiltInModel = resolveBuiltInProviderDefaultModel(
    settings,
    settings.piModelProvider,
    settings.piModelName
  );
  return `pi|${settings.piModelProvider}|${resolvedBuiltInModel}`;
}

export function buildModelOptions(settings: RuntimeSettings, route: ModelRoute): ModelOption[] {
  const patchKey = routePatchKey(route);

  const supportsRoute = (tags: string[]): boolean => {
    if (route === "text") return tags.includes("text");
    return tags.includes(route);
  };

  const options: ModelOption[] = [];
  const seen = new Set<string>();
  const pushOption = (option: ModelOption): void => {
    if (seen.has(option.key)) return;
    seen.add(option.key);
    options.push(option);
  };

  const pushBuiltInOption = (providerId: string, modelId: string): void => {
    const key = `pi|${providerId}|${modelId}`;
    pushOption({
      key,
      label: `[PI] ${providerId} / ${modelId}`,
      patch: {
        piModelProvider: providerId as RuntimeSettings["piModelProvider"],
        piModelName: modelId,
        modelRouting: {
          ...settings.modelRouting,
          [patchKey]: key
        }
      } as Partial<RuntimeSettings>
    });
  };

  if (route === "text" || route === "vision") {
    pushBuiltInOption(
      settings.piModelProvider,
      resolveBuiltInProviderDefaultModel(settings, settings.piModelProvider, settings.piModelName)
    );
  }

  for (const provider of settings.customProviders.filter((p) => p.enabled !== false && isKnownProvider(p.id))) {
    const models = provider.models.filter((m) => m.id?.trim() && supportsRoute(Array.isArray(m.tags) ? m.tags : ["text"]));
    for (const model of models) {
      pushBuiltInOption(provider.id, model.id.trim());
    }
  }

  for (const provider of settings.customProviders.filter((p) => p.enabled !== false && !isKnownProvider(p.id))) {
    const models = provider.models.filter((m) => m.id?.trim() && supportsRoute(Array.isArray(m.tags) ? m.tags : ["text"]));
    for (const model of models) {
      const modelId = model.id.trim();
      const updatedProviders = settings.customProviders.map((row) =>
        row.id === provider.id ? { ...row, defaultModel: modelId } : row
      );
      options.push({
        key: `custom|${provider.id}|${modelId}`,
        label: `[Custom] ${provider.name} / ${modelId}`,
        patch: {
          defaultCustomProviderId: route === "text" ? provider.id : settings.defaultCustomProviderId,
          customProviders: route === "text" ? updatedProviders : settings.customProviders,
          modelRouting: {
            ...settings.modelRouting,
            [patchKey]: `custom|${provider.id}|${modelId}`
          }
        }
      });
    }
  }

  return options;
}

export function resolveModelSelection(selector: string, options: ModelOption[]): ModelOption | null {
  const raw = selector.trim();
  if (!raw) return null;

  const asIndex = Number.parseInt(raw, 10);
  if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= options.length) {
    return options[asIndex - 1] ?? null;
  }

  return options.find((o) => o.key === raw) ?? null;
}

export function switchModelSelection(params: {
  settings: RuntimeSettings;
  route: ModelRoute;
  selector: string;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}): ModelSwitchResult | null {
  const options = buildModelOptions(params.settings, params.route);
  const selected = resolveModelSelection(params.selector, options);
  if (!selected) return null;

  return {
    route: params.route,
    selector: params.selector,
    selected,
    settings: params.updateSettings(selected.patch)
  };
}

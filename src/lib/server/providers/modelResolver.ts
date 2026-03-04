import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModels, getOAuthApiKey, type Model, type OAuthCredentials } from "@mariozechner/pi-ai";
import type { CustomProviderConfig, RuntimeSettings } from "../settings/index.js";
import { config } from "../app/env.js";

export type ModelUseCase = "text" | "vision";

export interface ResolvedModelSelection {
  model: Model<any>;
  source: "pi" | "custom";
  providerId: string;
  modelId: string;
  configuredModel?: CustomProviderConfig["models"][number];
}

const OAUTH_PROVIDER_IDS = new Set([
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity"
]);

function oauthAuthFileCandidates(): string[] {
  const configured = String(process.env.PI_AI_AUTH_FILE ?? "").trim();
  const candidates = [
    configured,
    path.join(config.dataDir, "auth.json"),
    path.join(process.cwd(), "auth.json")
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function normalizeOAuthCredentials(value: unknown): OAuthCredentials | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = row.type === "oauth" ? row : row;
  const access = String(source.access ?? "").trim();
  const refresh = String(source.refresh ?? "").trim();
  const expires = Number(source.expires ?? 0);
  if (!access || !refresh || !Number.isFinite(expires) || expires <= 0) return null;
  return {
    ...source,
    access,
    refresh,
    expires
  } as OAuthCredentials;
}

function loadOAuthAuthFile(): { filePath: string; raw: Record<string, unknown>; creds: Record<string, OAuthCredentials> } | null {
  for (const filePath of oauthAuthFileCandidates()) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const creds: Record<string, OAuthCredentials> = {};
      for (const [provider, value] of Object.entries(raw)) {
        const normalized = normalizeOAuthCredentials(value);
        if (normalized) creds[provider] = normalized;
      }
      return { filePath, raw, creds };
    } catch {
      continue;
    }
  }
  return null;
}

function persistOAuthAuthFile(
  filePath: string,
  raw: Record<string, unknown>,
  providerId: string,
  newCredentials: OAuthCredentials
): void {
  const current = raw[providerId];
  if (current && typeof current === "object" && (current as Record<string, unknown>).type === "oauth") {
    raw[providerId] = { ...(current as Record<string, unknown>), ...newCredentials, type: "oauth" };
  } else {
    raw[providerId] = { ...newCredentials, type: "oauth" };
  }
  writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n");
}

export function isOAuthProvider(providerId: string): boolean {
  return OAUTH_PROVIDER_IDS.has(providerId);
}

export function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = key.trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

function resolvePiModel(settings: RuntimeSettings): Model<any> {
  const models = getModels(settings.piModelProvider);
  const found = models.find((m) => m.id === settings.piModelName);
  if (found) return found;
  if (models[0]) return models[0];
  throw new Error(`No models available for provider '${settings.piModelProvider}'`);
}

function resolvePiModelByKey(provider: string, modelId: string): Model<any> | null {
  const models = getModels(provider as any);
  const found = models.find((m) => m.id === modelId);
  return found ?? null;
}

export function isCustomProviderUsable(provider: CustomProviderConfig): boolean {
  return provider.enabled !== false && Boolean(provider.baseUrl?.trim() && provider.apiKey?.trim());
}

export function isProviderEnabled(provider: CustomProviderConfig): boolean {
  return provider.enabled !== false;
}

function pickCustomModelId(provider: CustomProviderConfig, useCase: ModelUseCase): string {
  const rows = provider.models.filter((m) => Boolean(m.id?.trim()));
  if (rows.length === 0) return "";

  if (useCase === "vision") {
    const vision = rows.find((m) => Array.isArray(m.tags) && m.tags.includes("vision"));
    if (vision?.id) return vision.id;
  }

  const byDefault = rows.find((m) => m.id === provider.defaultModel);
  if (byDefault?.id) return byDefault.id;
  return rows[0]?.id ?? "";
}

export function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models.map((m) => m.id).filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

export function getSelectedCustomProvider(settings: RuntimeSettings): CustomProviderConfig | undefined {
  const enabledProviders = settings.customProviders.filter(isProviderEnabled);
  if (enabledProviders.length === 0) return undefined;
  return enabledProviders.find((p) => p.id === settings.defaultCustomProviderId) ?? enabledProviders[0];
}

export function getCustomProviderById(
  settings: RuntimeSettings,
  providerId: string
): CustomProviderConfig | undefined {
  const provider = settings.customProviders.find((p) => p.id === providerId);
  if (!provider || !isProviderEnabled(provider)) return undefined;
  return provider;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

function normalizePath(path: string | undefined): string {
  const raw = (path || "/v1/chat/completions").trim();
  if (!raw) return "/v1/chat/completions";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function buildOpenAIBaseUrl(baseUrl: string, path: string | undefined): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(path);
  const chatCompletionsSuffix = "/chat/completions";

  if (normalizedPath.endsWith(chatCompletionsSuffix)) {
    const prefix = normalizedPath.slice(0, -chatCompletionsSuffix.length);
    return `${base}${prefix}`;
  }

  const slash = normalizedPath.lastIndexOf("/");
  const dir = slash > 0 ? normalizedPath.slice(0, slash) : "";
  return `${base}${dir}`;
}

function resolveCustomModel(selected: CustomProviderConfig, modelId: string): Model<any> {
  const computedBaseUrl = buildOpenAIBaseUrl(selected.baseUrl, selected.path);
  return {
    id: modelId,
    name: selected.name || modelId,
    api: "openai-completions",
    provider: selected.id || "custom-provider",
    baseUrl: computedBaseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

export function resolveModelSelection(
  settings: RuntimeSettings,
  useCase: ModelUseCase = "text"
): ResolvedModelSelection {
  const routedKey = useCase === "vision" ? settings.modelRouting.visionModelKey : settings.modelRouting.textModelKey;
  const routed = parseModelKey(routedKey);
  if (routed) {
    if (routed.mode === "pi") {
      const pi = resolvePiModelByKey(routed.provider, routed.model);
      if (pi) {
        return {
          model: pi,
          source: "pi",
          providerId: routed.provider,
          modelId: routed.model
        };
      }
    } else {
      const provider = getCustomProviderById(settings, routed.provider);
      if (provider && isCustomProviderUsable(provider) && routed.model) {
        return {
          model: resolveCustomModel(provider, routed.model),
          source: "custom",
          providerId: provider.id,
          modelId: routed.model,
          configuredModel: provider.models.find((m) => m.id === routed.model)
        };
      }
    }
  }

  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? pickCustomModelId(selected, useCase) : "";
    if (selected && isCustomProviderUsable(selected) && modelId) {
      return {
        model: resolveCustomModel(selected, modelId),
        source: "custom",
        providerId: selected.id,
        modelId,
        configuredModel: selected.models.find((m) => m.id === modelId)
      };
    }
  }

  for (const provider of settings.customProviders.filter(isProviderEnabled)) {
    if (!isCustomProviderUsable(provider)) continue;
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    return {
      model: resolveCustomModel(provider, modelId),
      source: "custom",
      providerId: provider.id,
      modelId,
      configuredModel: provider.models.find((m) => m.id === modelId)
    };
  }

  const pi = resolvePiModel(settings);
  return {
    model: pi,
    source: "pi",
    providerId: settings.piModelProvider,
    modelId: pi.id
  };
}

export function resolveModel(settings: RuntimeSettings, useCase: ModelUseCase = "text"): Model<any> {
  return resolveModelSelection(settings, useCase).model;
}

export function envVarForProvider(provider: string): string | null {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
    case "openai-codex":
      return "OPENAI_API_KEY";
    case "google":
    case "google-antigravity":
    case "google-gemini-cli":
      return "GOOGLE_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "zai":
      return "ZAI_API_KEY";
    case "minimax":
    case "minimax-cn":
      return "MINIMAX_API_KEY";
    case "huggingface":
      return "HUGGINGFACE_API_KEY";
    default:
      return null;
  }
}

export function resolveApiKeyForProvider(providerId: string, settings: RuntimeSettings): string | undefined {
  const selectedCustom = settings.customProviders.find((p) => p.id === providerId && isProviderEnabled(p));
  if (selectedCustom?.apiKey?.trim()) return selectedCustom.apiKey.trim();

  const envVar = envVarForProvider(providerId);
  if (!envVar) return undefined;
  const value = process.env[envVar]?.trim();
  return value || undefined;
}

export function resolveApiKeyForModel(model: Model<any>, settings: RuntimeSettings): string | undefined {
  return resolveApiKeyForProvider(model.provider, settings);
}

export async function resolveApiKeyForProviderRuntime(
  providerId: string,
  settings: RuntimeSettings
): Promise<string | undefined> {
  const direct = resolveApiKeyForProvider(providerId, settings);
  if (direct) return direct;
  if (!isOAuthProvider(providerId)) return undefined;

  const auth = loadOAuthAuthFile();
  if (!auth) return undefined;
  const result = await getOAuthApiKey(providerId, auth.creds);
  if (!result?.apiKey) return undefined;
  if (result.newCredentials) {
    try {
      persistOAuthAuthFile(auth.filePath, auth.raw, providerId, result.newCredentials);
    } catch {
      // ignore auth file write errors, token can still be used for this request
    }
  }
  return result.apiKey;
}

export async function resolveApiKeyForModelRuntime(
  model: Model<any>,
  settings: RuntimeSettings
): Promise<string | undefined> {
  return resolveApiKeyForProviderRuntime(model.provider, settings);
}

export function validateAiProviderSettings(settings: RuntimeSettings): string | null {
  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? getProviderModel(selected) : "";
    if (!selected) {
      return "AI settings error: providerMode=custom but no enabled custom provider configured.";
    }
    if (!selected.baseUrl?.trim() || !selected.apiKey?.trim() || !modelId) {
      return "AI settings error: custom provider requires baseUrl, apiKey, and at least one model.";
    }
    return null;
  }

  const model = resolvePiModel(settings);
  const configuredProvider = getCustomProviderById(settings, model.provider);
  const configuredKey = configuredProvider?.apiKey?.trim();
  if (configuredKey) return null;
  const envVar = envVarForProvider(model.provider);
  if (envVar && !process.env[envVar]?.trim()) {
    if (isOAuthProvider(model.provider)) return null;
    return `AI settings error: missing API key for provider '${model.provider}'. Configure it in Settings > AI > Providers (id='${model.provider}') or set ${envVar}.`;
  }
  return null;
}

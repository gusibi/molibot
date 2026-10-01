import type {
  AdaptiveThinkingSettings,
  CloudflareDecisionModelSettings,
  DecisionModelSettings,
  JevDecisionModelSettings,
  LlmDecisionModelSettings,
  SiliconFlowDecisionModelSettings,
  CustomJevDecisionModelSettings,
  RuntimeSettings
} from "$lib/server/settings/index.js";
import { sanitizeAdaptiveThinkingSettings } from "$lib/server/settings/sanitize.js";
import {
  createAdaptiveThinkingProvider,
  createDecisionModelProvider,
  hasConfiguredAdaptiveThinkingProvider,
  listAvailableDecisionModelIds,
  LlmDecisionProvider
} from "$lib/server/agent/decision/adaptiveThinking.js";
import { CloudflareJevProvider, resolveTypeSafeBaseUrl, TypeSafeJevProvider } from "$lib/server/agent/decision/jev/index.js";
import { buildModelOptions } from "$lib/server/settings/modelSwitch.js";
import { parseEvaluationCaseId, type EvaluationCaseResult } from "$lib/server/agent/decision/jev/evaluationCases.js";
import type { SettingsAccessor } from "./locale.js";

type SafeDecisionModelSettings =
  | (Omit<JevDecisionModelSettings, "apiKey"> & { hasApiKey: boolean })
  | (Omit<CloudflareDecisionModelSettings, "apiToken"> & { hasApiToken: boolean })
  | (Omit<SiliconFlowDecisionModelSettings, "apiKey"> & { hasApiKey: boolean })
  | (Omit<CustomJevDecisionModelSettings, "apiKey"> & { hasApiKey: boolean })
  | LlmDecisionModelSettings;

export interface AdaptiveThinkingConfig extends Omit<AdaptiveThinkingSettings, "decisionModels"> {
  decisionModels: SafeDecisionModelSettings[];
  availableDecisionModelIds: string[];
}

function project(settings: AdaptiveThinkingSettings, availableDecisionModelIds: string[] = []): AdaptiveThinkingConfig {
  return {
    ...settings,
    decisionModels: settings.decisionModels.map((model) => {
      if (model.provider === "jev") {
        const { apiKey, ...safe } = model;
        return { ...safe, hasApiKey: Boolean(apiKey) };
      }
      if (model.provider === "cloudflare") {
        const { apiToken, ...safe } = model;
        return { ...safe, hasApiToken: Boolean(apiToken) };
      }
      if (model.provider === "siliconflow" || model.provider === "custom-jev") {
        const { apiKey, ...safe } = model;
        return { ...safe, hasApiKey: Boolean(apiKey) };
      }
      return { ...model };
    }),
    availableDecisionModelIds
  };
}

export function readAdaptiveThinkingConfig(runtime: SettingsAccessor): AdaptiveThinkingConfig {
  return project(runtime.getSettings().adaptiveThinking);
}

export async function readAvailableDecisionModelIds(runtime: SettingsAccessor): Promise<string[]> {
  return listAvailableDecisionModelIds(runtime.getSettings());
}

export async function readAdaptiveThinkingAvailability(runtime: SettingsAccessor): Promise<boolean> {
  const settings = runtime.getSettings();
  try {
    if (!hasConfiguredAdaptiveThinkingProvider(settings)) return false;
    return Boolean(await createAdaptiveThinkingProvider(settings));
  } catch {
    return false;
  }
}

export function updateAdaptiveThinkingConfig(
  runtime: SettingsAccessor,
  input: Record<string, unknown>
): AdaptiveThinkingConfig {
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("Adaptive Thinking enabled must be a boolean.");
  }
  if (input.defaultStrategy !== undefined && input.defaultStrategy !== "fixed" && input.defaultStrategy !== "auto") {
    throw new Error("Adaptive Thinking default strategy must be fixed or auto.");
  }
  for (const field of ["maxThinkingLevel", "fallbackThinkingLevel"] as const) {
    if (input[field] !== undefined && !["low", "medium", "high"].includes(input[field] as string)) {
      throw new Error("Adaptive Thinking " + field + " must be low, medium, or high.");
    }
  }
  if (input.confidenceThreshold !== undefined && (typeof input.confidenceThreshold !== "number"
    || !Number.isFinite(input.confidenceThreshold) || input.confidenceThreshold < 0 || input.confidenceThreshold > 1)) {
    throw new Error("Adaptive Thinking confidence threshold must be a number between 0 and 1.");
  }
  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== "number"
    || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 5000)) {
    throw new Error("Adaptive Thinking timeout must be an integer between 100 and 5000 milliseconds.");
  }
  const current = runtime.getSettings().adaptiveThinking;
  const currentModels = new Map(current.decisionModels.map((model) => [model.id, model]));
  const rawModels = Array.isArray(input.decisionModels) ? input.decisionModels : current.decisionModels;
  const suppliedKeys = input.apiKeys && typeof input.apiKeys === "object"
    ? input.apiKeys as Record<string, unknown>
    : {};
  const clearApiKeys = new Set(Array.isArray(input.clearApiKeys) ? input.clearApiKeys.map(String) : []);

  const decisionModels: DecisionModelSettings[] = [];
  for (const rawModel of rawModels) {
    if (!rawModel || typeof rawModel !== "object") continue;
    const model = rawModel as Record<string, unknown>;
    if (model.provider === "jev") {
      const saved = currentModels.get("jev");
      const savedJev = saved?.provider === "jev" ? saved : undefined;
      const baseUrl = resolveTypeSafeBaseUrl(String(model.baseUrl ?? savedJev?.baseUrl ?? ""));
      const suppliedKey = typeof suppliedKeys.jev === "string" ? suppliedKeys.jev.trim() : "";
      const clearKey = clearApiKeys.has("jev");
      if (savedJev?.apiKey && baseUrl !== resolveTypeSafeBaseUrl(savedJev.baseUrl) && !suppliedKey && !clearKey) {
        throw new Error("Changing the Jev Host requires entering a new API key for that host.");
      }
      decisionModels.push({
        id: "jev",
        provider: "jev",
        enabled: model.enabled === undefined ? savedJev?.enabled !== false : Boolean(model.enabled),
        baseUrl,
        apiKey: suppliedKey || (clearKey ? "" : savedJev?.apiKey ?? "")
      });
    } else if (model.provider === "llm") {
      const saved = currentModels.get("llm");
      const savedLlm = saved?.provider === "llm" ? saved : undefined;
      const llmModelKey = String(model.llmModelKey ?? savedLlm?.llmModelKey ?? "").trim();
      if (llmModelKey && !buildModelOptions(runtime.getSettings(), "text").some((option) => option.key === llmModelKey)) {
        throw new Error("The selected LLM decision model is not available in the text model list.");
      }
      decisionModels.push({ id: "llm", provider: "llm", enabled: model.enabled === undefined ? savedLlm?.enabled !== false : Boolean(model.enabled), llmModelKey });
    } else if (model.provider === "cloudflare") {
      const saved = currentModels.get("cloudflare-jev");
      const savedCloudflare = saved?.provider === "cloudflare" ? saved : undefined;
      const accountId = String(model.accountId ?? savedCloudflare?.accountId ?? "").trim();
      const suppliedToken = typeof suppliedKeys["cloudflare-jev"] === "string"
        ? (suppliedKeys["cloudflare-jev"] as string).trim()
        : "";
      const clearToken = clearApiKeys.has("cloudflare-jev");
      if (savedCloudflare?.apiToken && accountId !== savedCloudflare.accountId && !suppliedToken && !clearToken) {
        throw new Error("Changing the Cloudflare Account ID requires entering a new API token.");
      }
      decisionModels.push({
        id: "cloudflare-jev",
        provider: "cloudflare",
        enabled: model.enabled === undefined ? savedCloudflare?.enabled !== false : Boolean(model.enabled),
        accountId,
        apiToken: suppliedToken || (clearToken ? "" : savedCloudflare?.apiToken ?? "")
      });
    } else if (model.provider === "siliconflow") {
      const id = String(model.id ?? "").trim();
      if (!/^siliconflow(?:-[1-9]\d*)?$/.test(id)) continue;
      const saved = currentModels.get(id);
      const savedSiliconFlow = saved?.provider === "siliconflow" ? saved : undefined;
      const baseUrl = resolveTypeSafeBaseUrl(String(model.baseUrl ?? savedSiliconFlow?.baseUrl ?? "https://api.siliconflow.cn"));
      const suppliedKey = typeof suppliedKeys[id] === "string" ? suppliedKeys[id].trim() : "";
      const clearKey = clearApiKeys.has(id);
      if (savedSiliconFlow?.apiKey && baseUrl !== savedSiliconFlow.baseUrl && !suppliedKey && !clearKey) {
        throw new Error("Changing the SiliconFlow API host requires entering a new API key for that host.");
      }
      decisionModels.push({
        id,
        provider: "siliconflow",
        enabled: model.enabled === undefined ? savedSiliconFlow?.enabled !== false : Boolean(model.enabled),
        baseUrl,
        modelId: String(model.modelId ?? savedSiliconFlow?.modelId ?? "").trim(),
        apiKey: suppliedKey || (clearKey ? "" : savedSiliconFlow?.apiKey ?? "")
      });
    } else if (model.provider === "custom-jev") {
      const id = String(model.id ?? "").trim();
      if (!/^custom-jev-[1-9]\d*$/.test(id)) continue;
      const saved = currentModels.get(id);
      const savedCustom = saved?.provider === "custom-jev" ? saved : undefined;
      const rawBaseUrl = String(model.baseUrl ?? savedCustom?.baseUrl ?? "").trim();
      const baseUrl = rawBaseUrl ? resolveTypeSafeBaseUrl(rawBaseUrl) : "";
      const suppliedKey = typeof suppliedKeys[id] === "string" ? suppliedKeys[id].trim() : "";
      const clearKey = clearApiKeys.has(id);
      if (savedCustom?.apiKey && baseUrl !== savedCustom.baseUrl && !suppliedKey && !clearKey) {
        throw new Error("Changing a custom Jev Host requires entering a new API key for that host.");
      }
      decisionModels.push({
        id,
        provider: "custom-jev",
        enabled: model.enabled === undefined ? savedCustom?.enabled !== false : Boolean(model.enabled),
        name: String(model.name ?? savedCustom?.name ?? "").trim(),
        baseUrl,
        modelId: String(model.modelId ?? savedCustom?.modelId ?? "").trim(),
        apiKey: suppliedKey || (clearKey ? "" : savedCustom?.apiKey ?? "")
      });
    }
  }

  const updatedInput = {
    ...current,
    ...input,
    decisionModels
  };
  const sanitized = sanitizeAdaptiveThinkingSettings(updatedInput, current);
  for (const model of sanitized.decisionModels) {
    if (model.enabled === false) continue;
    if (model.provider === "jev" && (!model.baseUrl || !model.apiKey)) throw new Error("Configure the Jev Host and API key before enabling it.");
    if (model.provider === "llm" && !model.llmModelKey) throw new Error("Choose a text model before enabling the LLM decision model.");
    if (model.provider === "cloudflare" && (!model.accountId || !model.apiToken)) throw new Error("Configure the Cloudflare account and API token before enabling it.");
    if (model.provider === "siliconflow" && (!model.baseUrl || !model.modelId || !model.apiKey)) throw new Error("Configure the SiliconFlow Host, model ID, and API key before enabling it.");
    if (model.provider === "custom-jev" && (!model.name || !model.baseUrl || !model.modelId || !model.apiKey)) throw new Error("Configure the custom Jev name, Host, model ID, and API key before enabling it.");
  }
  const updated = runtime.updateSettings({ adaptiveThinking: sanitized });
  return project(updated.adaptiveThinking);
}

const CONNECTION_TEST_TIMEOUT_MS = 30_000;

export async function testDecisionModelCase(runtime: SettingsAccessor, input: {
  provider?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  accountId?: unknown;
  llmModelKey?: unknown;
  modelId?: unknown;
  decisionModelId?: unknown;
  testCaseId?: unknown;
}): Promise<EvaluationCaseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS);
  try {
    const testCaseId = parseEvaluationCaseId(input.testCaseId);
    const provider = input.provider === "llm" || input.provider === "cloudflare" || input.provider === "siliconflow" || input.provider === "custom-jev" ? input.provider : "jev";
    if (provider === "jev") {
      const baseUrl = resolveTypeSafeBaseUrl(String(input.baseUrl ?? ""));
      const suppliedKey = String(input.apiKey ?? "").trim();
      const saved = runtime.getSettings().adaptiveThinking.decisionModels.find((model) => model.id === "jev");
      const apiKey = suppliedKey || (saved?.provider === "jev" && saved.baseUrl === baseUrl ? saved.apiKey : "");
      if (!baseUrl || !apiKey) throw new Error("Jev Host and API key are required.");
      return await new TypeSafeJevProvider(baseUrl, apiKey).evaluateTestCase(testCaseId, controller.signal);
    }

    if (provider === "cloudflare") {
      const accountId = String(input.accountId ?? "").trim();
      const suppliedToken = String(input.apiKey ?? "").trim();
      const saved = runtime.getSettings().adaptiveThinking.decisionModels.find((model) => model.id === "cloudflare-jev");
      const savedCloudflare = saved?.provider === "cloudflare" ? saved : undefined;
      const apiToken = suppliedToken || (savedCloudflare?.accountId === accountId ? savedCloudflare.apiToken : "");
      if (!accountId || !apiToken) throw new Error("Cloudflare Account ID and API token are required.");
      return await new CloudflareJevProvider(accountId, apiToken).evaluateTestCase(testCaseId, controller.signal);
    }

    if (provider === "siliconflow" || provider === "custom-jev") {
      const id = String(input.decisionModelId ?? "").trim();
      const baseUrl = resolveTypeSafeBaseUrl(String(input.baseUrl ?? "").trim());
      const modelId = String(input.modelId ?? "").trim();
      const suppliedKey = String(input.apiKey ?? "").trim();
      const saved = runtime.getSettings().adaptiveThinking.decisionModels.find((model) => model.id === id);
      const savedSystemOne = saved?.provider === provider ? saved : undefined;
      const apiKey = suppliedKey || (savedSystemOne?.baseUrl === baseUrl && savedSystemOne.modelId === modelId ? savedSystemOne.apiKey : "");
      const configured: SiliconFlowDecisionModelSettings | CustomJevDecisionModelSettings = provider === "siliconflow"
        ? { id, provider, baseUrl, modelId, apiKey }
        : { id, provider, enabled: true, name: "Connection test", baseUrl, modelId, apiKey };
      const adapter = await createDecisionModelProvider(runtime.getSettings(), configured);
      if (!(adapter instanceof TypeSafeJevProvider)) throw new Error("System One API host, model ID, and API key are required.");
      return await adapter.evaluateTestCase(testCaseId, controller.signal);
    }

    const current = runtime.getSettings();
    const modelKey = String(input.llmModelKey ?? "").trim();
    if (!modelKey) throw new Error("Select a text model for the LLM decision provider.");
    const llmModel: LlmDecisionModelSettings = { id: "llm", provider: "llm", llmModelKey: modelKey };
    const decisionModels = [
      ...current.adaptiveThinking.decisionModels.filter((model) => model.id !== "llm"),
      llmModel
    ];
    const adaptiveThinking = sanitizeAdaptiveThinkingSettings({
      ...current.adaptiveThinking,
      enabled: true,
      decisionModels,
      selectedDecisionModelId: "llm"
    }, current.adaptiveThinking);
    const configured = await createDecisionModelProvider({ ...current, adaptiveThinking }, llmModel);
    if (!(configured instanceof LlmDecisionProvider)) throw new Error("The selected LLM model has no available credentials.");
    return await configured.evaluateTestCase(testCaseId, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Connection test timed out after 30 seconds.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

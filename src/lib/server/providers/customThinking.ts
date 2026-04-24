import type { Model } from "@mariozechner/pi-ai";
import type {
  CustomProviderConfig,
  RuntimeReasoningEffortLevel,
  RuntimeSettings,
  RuntimeThinkingLevel
} from "../settings/index.js";

function cleanReasoningEffortMap(
  map: CustomProviderConfig["reasoningEffortMap"]
): Partial<Record<RuntimeReasoningEffortLevel, string>> | undefined {
  if (!map) return undefined;
  const out: Partial<Record<RuntimeReasoningEffortLevel, string>> = {};
  for (const level of ["low", "medium", "high"] as const) {
    const value = String(map[level] ?? "").trim();
    if (value) out[level] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveCustomProviderReasoningSupport(
  provider: Pick<CustomProviderConfig, "supportsThinking">
): boolean {
  return provider.supportsThinking === true;
}

export function resolveThinkingLevel(
  settings: Pick<RuntimeSettings, "defaultThinkingLevel">,
  supportsThinking: boolean
): RuntimeThinkingLevel {
  const requested = settings.defaultThinkingLevel ?? "off";
  if (!supportsThinking) return "off";
  return requested === "off" ? "off" : requested;
}

export function usesThinkingTypeFormat(
  provider: Pick<CustomProviderConfig, "thinkingFormat">
): boolean {
  return provider.thinkingFormat === "thinking-type";
}

export function buildCustomProviderCompat(
  provider: Pick<CustomProviderConfig, "thinkingFormat" | "reasoningEffortMap">
): Model<"openai-completions">["compat"] | undefined {
  const reasoningEffortMap = cleanReasoningEffortMap(provider.reasoningEffortMap);
  if (usesThinkingTypeFormat(provider)) {
    return {
      supportsReasoningEffort: false,
      reasoningEffortMap
    };
  }
  if (!provider.thinkingFormat && !reasoningEffortMap) return undefined;

  return {
    thinkingFormat: provider.thinkingFormat,
    reasoningEffortMap
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeThinkingTypePayload(
  payload: unknown,
  thinkingLevel: RuntimeThinkingLevel
): unknown {
  if (!isObject(payload)) return payload;

  const next: Record<string, unknown> = { ...payload };
  delete next.reasoning_effort;
  delete next.reasoning;
  delete next.enable_thinking;
  delete next.chat_template_kwargs;

  if (thinkingLevel === "off") {
    delete next.thinking;
  } else {
    next.thinking = { type: "enabled" };
  }

  return next;
}

export function applyDirectReasoningParams(
  payload: Record<string, unknown>,
  provider: Pick<CustomProviderConfig, "supportsThinking" | "thinkingFormat" | "reasoningEffortMap">,
  thinkingLevel: RuntimeThinkingLevel
): Record<string, unknown> {
  if (!resolveCustomProviderReasoningSupport(provider) || thinkingLevel === "off") {
    return payload;
  }

  const reasoningEffortMap = cleanReasoningEffortMap(provider.reasoningEffortMap);
  const mappedEffort = reasoningEffortMap?.[thinkingLevel] ?? thinkingLevel;

  if (usesThinkingTypeFormat(provider)) {
    return {
      ...payload,
      thinking: {
        type: "enabled"
      }
    };
  }

  switch (provider.thinkingFormat) {
    case "openrouter":
      return {
        ...payload,
        reasoning: {
          effort: mappedEffort
        }
      };
    case "zai":
    case "qwen":
      return {
        ...payload,
        enable_thinking: true
      };
    case "qwen-chat-template":
      return {
        ...payload,
        chat_template_kwargs: {
          enable_thinking: true
        }
      };
    case "openai":
    default:
      return {
        ...payload,
        reasoning_effort: mappedEffort
      };
  }
}

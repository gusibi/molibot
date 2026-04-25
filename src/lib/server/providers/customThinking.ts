import type { Model } from "@mariozechner/pi-ai";
import type {
  CustomProviderConfig,
  RuntimeReasoningEffortLevel,
  RuntimeSettings,
  RuntimeThinkingLevel
} from "../settings/index.js";

const DEEPSEEK_REASONING_EFFORT_MAP = {
  low: "high",
  medium: "high",
  high: "high"
} as const satisfies Partial<Record<RuntimeReasoningEffortLevel, string>>;

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

export function buildCustomProviderCompat(
  provider: Pick<CustomProviderConfig, "thinkingFormat" | "reasoningEffortMap">
): Model<"openai-completions">["compat"] | undefined {
  const configuredMap = cleanReasoningEffortMap(provider.reasoningEffortMap);
  const reasoningEffortMap = provider.thinkingFormat === "deepseek"
    ? { ...DEEPSEEK_REASONING_EFFORT_MAP, ...configuredMap }
    : configuredMap;
  if (!provider.thinkingFormat && !reasoningEffortMap) return undefined;

  return {
    thinkingFormat: provider.thinkingFormat,
    reasoningEffortMap
  };
}

export function applyDirectReasoningParams(
  payload: Record<string, unknown>,
  provider: Pick<CustomProviderConfig, "supportsThinking" | "thinkingFormat" | "reasoningEffortMap">,
  thinkingLevel: RuntimeThinkingLevel
): Record<string, unknown> {
  if (!resolveCustomProviderReasoningSupport(provider) || thinkingLevel === "off") {
    return payload;
  }

  const configuredMap = cleanReasoningEffortMap(provider.reasoningEffortMap);
  const reasoningEffortMap = provider.thinkingFormat === "deepseek"
    ? { ...DEEPSEEK_REASONING_EFFORT_MAP, ...configuredMap }
    : configuredMap;
  const mappedEffort = reasoningEffortMap?.[thinkingLevel] ?? thinkingLevel;

  switch (provider.thinkingFormat) {
    case "deepseek": {
      const deepseekEffort = reasoningEffortMap?.[thinkingLevel] ?? "high";
      return {
        ...payload,
        reasoning_effort: deepseekEffort,
        thinking: {
          type: "enabled"
        }
      };
    }
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

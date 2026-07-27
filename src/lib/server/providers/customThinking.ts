import type { Model } from "@earendil-works/pi-ai";
import type {
  CustomProviderConfig,
  RuntimeSettings,
  RuntimeThinkingLevel
} from "$lib/server/settings/index.js";

export function resolveThinkingLevel(
  settings: Pick<RuntimeSettings, "defaultThinkingLevel">
): RuntimeThinkingLevel {
  return settings.defaultThinkingLevel ?? "off";
}

export function buildCustomProviderCompat(
  provider: Pick<CustomProviderConfig, "thinkingFormat">
): Model<"openai-completions">["compat"] | undefined {
  if (provider.thinkingFormat === "anthropic") return undefined;
  if (!provider.thinkingFormat) return undefined;

  return {
    thinkingFormat: provider.thinkingFormat
  };
}

export function applyDirectReasoningParams(
  payload: Record<string, unknown>,
  provider: Pick<CustomProviderConfig, "thinkingFormat">,
  thinkingLevel: RuntimeThinkingLevel
): Record<string, unknown> {
  if (thinkingLevel === "off") return payload;

  switch (provider.thinkingFormat) {
    case "deepseek": {
      return {
        ...payload,
        reasoning_effort: thinkingLevel,
        thinking: {
          type: "enabled"
        }
      };
    }
    case "openrouter":
      return {
        ...payload,
        reasoning: {
          effort: thinkingLevel
        }
      };
    case "anthropic":
      return {
        ...payload,
        temperature: undefined,
        thinking: {
          type: "adaptive",
          effort: thinkingLevel
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
        reasoning_effort: thinkingLevel
      };
  }
}

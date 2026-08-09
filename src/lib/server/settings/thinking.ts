export const RUNTIME_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;
export type RuntimeThinkingLevel = (typeof RUNTIME_THINKING_LEVELS)[number];

export const CUSTOM_PROVIDER_THINKING_FORMATS = [
  "openai",
  "openrouter",
  "anthropic",
  "deepseek",
  "zai",
  "qwen",
  "qwen-chat-template"
] as const;
export type CustomProviderThinkingFormat = (typeof CUSTOM_PROVIDER_THINKING_FORMATS)[number];


const THINKING_LEVEL_SET = new Set<string>(RUNTIME_THINKING_LEVELS);
const THINKING_FORMAT_SET = new Set<string>(CUSTOM_PROVIDER_THINKING_FORMATS);

interface CustomProviderThinkingFormatPreset {
  readonly format: CustomProviderThinkingFormat;
  readonly markers: readonly string[];
}

const CUSTOM_PROVIDER_THINKING_FORMAT_PRESETS = [
  { format: "deepseek", markers: ["deepseek"] },
  { format: "anthropic", markers: ["anthropic", "claude"] }
] as const satisfies readonly CustomProviderThinkingFormatPreset[];

export function sanitizeRuntimeThinkingLevel(
  value: unknown,
  fallback: RuntimeThinkingLevel = "off"
): RuntimeThinkingLevel {
  const normalized = String(value ?? "").trim().toLowerCase();
  return THINKING_LEVEL_SET.has(normalized)
    ? normalized as RuntimeThinkingLevel
    : fallback;
}

/**
 * A request-level thinking value is an override, not a second default.
 * Missing or invalid input must stay absent so the runner can use the runtime
 * setting instead of silently replacing it with `off`.
 */
export function sanitizeOptionalRuntimeThinkingLevel(
  value: unknown
): RuntimeThinkingLevel | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return THINKING_LEVEL_SET.has(normalized)
    ? normalized as RuntimeThinkingLevel
    : undefined;
}

export function sanitizeOptionalThinkingFormat(
  value: unknown
): CustomProviderThinkingFormat | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "thinking-type") return "deepseek";
  return THINKING_FORMAT_SET.has(normalized)
    ? normalized as CustomProviderThinkingFormat
    : undefined;
}

export function resolveCustomProviderThinkingFormat(
  value: unknown,
  provider: { id?: unknown; name?: unknown; baseUrl?: unknown }
): CustomProviderThinkingFormat | undefined {
  const explicit = sanitizeOptionalThinkingFormat(value);
  if (explicit) return explicit;

  const markerText = [provider.id, provider.name, provider.baseUrl]
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!markerText) return undefined;

  return CUSTOM_PROVIDER_THINKING_FORMAT_PRESETS.find((preset) =>
    preset.markers.some((marker) => markerText.includes(marker))
  )?.format;
}

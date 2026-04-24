export const RUNTIME_THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type RuntimeThinkingLevel = (typeof RUNTIME_THINKING_LEVELS)[number];

export const CUSTOM_PROVIDER_THINKING_FORMATS = [
  "openai",
  "openrouter",
  "thinking-type",
  "zai",
  "qwen",
  "qwen-chat-template"
] as const;
export type CustomProviderThinkingFormat = (typeof CUSTOM_PROVIDER_THINKING_FORMATS)[number];

export type RuntimeReasoningEffortLevel = Exclude<RuntimeThinkingLevel, "off">;
export type ReasoningEffortMap = Partial<Record<RuntimeReasoningEffortLevel, string>>;

const THINKING_LEVEL_SET = new Set<string>(RUNTIME_THINKING_LEVELS);
const THINKING_FORMAT_SET = new Set<string>(CUSTOM_PROVIDER_THINKING_FORMATS);

interface CustomProviderThinkingFormatPreset {
  readonly format: CustomProviderThinkingFormat;
  readonly markers: readonly string[];
}

const CUSTOM_PROVIDER_THINKING_FORMAT_PRESETS = [
  { format: "thinking-type", markers: ["deepseek"] }
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

export function sanitizeOptionalThinkingSupport(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "enabled" || normalized === "true") return true;
  if (normalized === "disabled" || normalized === "false") return false;
  return undefined;
}

export function sanitizeOptionalThinkingFormat(
  value: unknown
): CustomProviderThinkingFormat | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "deepseek") return "thinking-type";
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

export function sanitizeReasoningEffortMap(value: unknown): ReasoningEffortMap | undefined {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as Record<string, unknown>;
  const out: ReasoningEffortMap = {};
  for (const level of RUNTIME_THINKING_LEVELS) {
    if (level === "off") continue;
    const mapped = String(raw[level] ?? "").trim();
    if (mapped) out[level] = mapped;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

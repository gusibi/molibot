import type { Locale } from "./i18n";

const WORDS: Record<string, string> = {
  ai: "AI",
  api: "API",
  asr: "ASR",
  aws: "AWS",
  bedrock: "Bedrock",
  claude: "Claude",
  deepseek: "DeepSeek",
  doubao: "Doubao",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  hy3: "HY3",
  kimi: "Kimi",
  lite: "Lite",
  llm: "LLM",
  minimax: "MiniMax",
  openai: "OpenAI",
  qwen: "Qwen",
  seed: "Seed",
  stt: "STT",
  teleai: "TeleAI",
  telespeechasr: "TeleSpeech ASR",
  tencent: "Tencent",
  tts: "TTS"
};

function humanizeWord(word: string): string {
  const known = WORDS[word.toLowerCase()];
  if (known) return known;
  if (/^v\d/i.test(word)) return `V${word.slice(1)}`;
  if (/[A-Z]/.test(word.slice(1))) return word;
  return word ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
}

export function humanizeTechnicalName(value: string): string {
  return value
    .trim()
    .replace(/^\[[^\]]+\]\s*/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(humanizeWord)
    .join(" ");
}

function humanizePath(value: string): string {
  return value
    .split("/")
    .map((part) => humanizeTechnicalName(part))
    .filter(Boolean)
    .join(" · ");
}

export function humanizeModelOption(label: string, key: string): { label: string; technicalId: string } {
  const source = label.trim().replace(/^\[[^\]]+\]\s*/, "");
  const [provider, ...modelParts] = source.split("/").map((part) => part.trim()).filter(Boolean);
  const providerDisplay = humanizeTechnicalName(provider);
  const modelDisplay = modelParts.length > 0 ? humanizeTechnicalName(modelParts.at(-1) ?? "") : humanizePath(source || key.replace(/^[^|]*\|/, ""));
  const display = modelParts.length > 0
    ? (modelDisplay.toLowerCase().startsWith(`${providerDisplay.toLowerCase()} `) ? modelDisplay : [providerDisplay, modelDisplay].filter(Boolean).join(" · "))
    : modelDisplay;
  return { label: display || label || key, technicalId: key.trim() };
}

/** Formats a compact model display name, stripping provider prefix (e.g. "Cli Proxy API · Gemini 3.7 Flash High" -> "Gemini 3.7 Flash High"). */
export function modelShortLabel(labelOrKey: string): string {
  const raw = labelOrKey.trim().replace(/^\[[^\]]+\]\s*/, "");
  const unnamespaced = raw.includes("::") ? (raw.split("::").pop() ?? raw) : raw.includes("|") ? (raw.split("|").pop() ?? raw) : raw;
  const humanized = humanizeModelOption(unnamespaced, unnamespaced).label;
  return humanized.split(" · ").at(-1) || labelOrKey;
}

/** Formats a token count compactly (e.g. 17000 -> "17k", 3632294 -> "3.6m", 500 -> "500"). */
export function formatCompactTokens(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    const formatted = (k >= 100 || n % 1_000 === 0) ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, "");
    return `${formatted}k`;
  }
  const m = n / 1_000_000;
  const formatted = (m >= 100 || n % 1_000_000 === 0) ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, "");
  return `${formatted}m`;
}

/**
 * Token count in the unit the locale reads naturally: 万-based for Chinese
 * (26200 -> "2.62万"), `formatCompactTokens` for English (26200 -> "26.2k").
 */
export function formatContextTokens(value: number, locale: Locale): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (locale !== "zh-CN" || n < 10_000) return formatCompactTokens(n);
  const wan = n / 10_000;
  const formatted = wan >= 100 ? Math.round(wan).toString() : wan.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}万`;
}

/** One rendered row of the composer context-usage panel. */
export interface ComposerContextUsageCategory {
  key: "messages" | "mcpTools" | "systemTools" | "systemPrompt" | "skills" | "other";
  tokens: number;
  /** Share of the estimated dispatch total, 0-100. */
  percent: number;
}

/** Everything the composer context-usage panel renders, already derived. */
export interface ComposerContextUsage {
  /** 0 when the window is unknown (no snapshot and no model config): the panel then hides the bar and percent. */
  contextWindow: number;
  /**
   * Context in use right now: the last model call's input (incl. cache) plus
   * that call's reply — the size the NEXT dispatch starts from.
   */
  usedTokens: number;
  /** `usedTokens / contextWindow` in percent, clamped for display; 0 without a window. */
  percent: number;
  /** Empty for sessions without a dispatch snapshot: the category rows stay hidden. */
  categories: ComposerContextUsageCategory[];
}

type ContextUsageSourceMessage = {
  role: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  contextBreakdown?: {
    contextWindow: number;
    estimatedTokens: number;
    breakdown: Record<ComposerContextUsageCategory["key"], number>;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

/** The selected model's configured context window, 0 when unknown. */
export function resolveModelContextWindow(
  options: readonly { key: string; contextWindow?: number }[],
  activeKey: string
): number {
  return options.find((option) => option.key === activeKey)?.contextWindow ?? 0;
}

/**
 * Derives the composer context-usage panel data from a transcript. The
 * snapshot rides the last assistant row that carries one (each model call
 * refreshes it); `usedTokens` = that call's own input side (cache included)
 * plus its reply output — the live context the next dispatch starts from.
 * Intermediate tool-call outputs of the turn are already inside the last
 * call's input, and the transcript only carries the turn-aggregated output,
 * so the sum slightly overcounts by those (a few dozen tokens per call).
 * Cache hit rate lives in the session usage summary (cumulative token sums),
 * never in a per-call mean.
 *
 * Sessions transcribed before snapshots existed still have the real per-turn
 * usage: they degrade to turn-aggregated usage (input + output) against
 * `fallbackContextWindow` (the selected model's config), with category rows
 * omitted — multi-call turns overcount there, and that is the best the data
 * offers. `null` means the transcript has no model usage at all (fresh
 * conversation).
 */
export function deriveComposerContextUsage(
  messages: readonly ContextUsageSourceMessage[],
  fallbackContextWindow = 0
): ComposerContextUsage | null {
  let snapshot: NonNullable<ContextUsageSourceMessage["contextBreakdown"]> | null = null;
  let snapshotOutputTokens = 0;
  let lastUsage: NonNullable<ContextUsageSourceMessage["usage"]> | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const usage = message.usage;
    if (
      usage &&
      !lastUsage &&
      (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) > 0
    ) {
      lastUsage = usage;
    }
    if (!snapshot && message.contextBreakdown) {
      snapshot = message.contextBreakdown;
      snapshotOutputTokens = Math.max(0, Math.round(usage?.outputTokens ?? lastUsage?.outputTokens ?? 0));
    }
  }
  if (!snapshot && !lastUsage) return null;
  const contextWindow = snapshot && snapshot.contextWindow > 0 ? snapshot.contextWindow : fallbackContextWindow;
  const inputSide = snapshot
    ? (snapshot.inputTokens ?? 0) + (snapshot.cacheReadTokens ?? 0) + (snapshot.cacheWriteTokens ?? 0)
    : (lastUsage!.inputTokens ?? 0) + (lastUsage!.cacheReadTokens ?? 0) + (lastUsage!.cacheWriteTokens ?? 0);
  const outputTokens = snapshot ? snapshotOutputTokens : Math.max(0, Math.round(lastUsage?.outputTokens ?? 0));
  const usedTokens = Math.max(0, Math.round(inputSide) + outputTokens);
  const percent = contextWindow > 0 ? Math.min(100, (usedTokens / contextWindow) * 100) : 0;
  const total = snapshot && snapshot.estimatedTokens > 0 ? snapshot.estimatedTokens : 1;
  const order: ComposerContextUsageCategory["key"][] = ["messages", "mcpTools", "systemTools", "systemPrompt", "skills", "other"];
  const categories = snapshot
    ? order.map((key) => {
        const tokens = Math.max(0, Math.round(snapshot!.breakdown[key] ?? 0));
        return { key, tokens, percent: (tokens / total) * 100 };
      })
    : [];
  return {
    contextWindow,
    usedTokens,
    percent,
    categories
  };
}

/** The session usage summary the detail API returns (structurally typed). */
export interface SessionUsageSummarySource {
  available: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  coverageStart: string | null;
}

/** Panel-ready cumulative session usage. */
export interface ComposerSessionUsage {
  requests: number;
  totalTokens: number;
  /** Full input: uncached + cache read + cache write; the cache rows are its breakdown, not additions. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Cumulative cache read / full input; null without any reported input (never a fabricated 0%). */
  hitRate: number | null;
}

/**
 * Derives the session-cumulative panel section from the server summary.
 * `null` when the ledger could not be read — the panel then shows an explicit
 * unavailable state instead of zero usage.
 */
export function deriveSessionUsageView(summary: SessionUsageSummarySource | null | undefined): ComposerSessionUsage | null {
  if (!summary?.available) return null;
  const cacheReadTokens = Math.max(0, Math.round(summary.cacheReadTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Math.round(summary.cacheWriteTokens ?? 0));
  const inputTokens = Math.max(0, Math.round(summary.inputTokens ?? 0)) + cacheReadTokens + cacheWriteTokens;
  return {
    requests: Math.max(0, Math.round(summary.requests ?? 0)),
    totalTokens: Math.max(0, Math.round(summary.totalTokens ?? 0)),
    inputTokens,
    outputTokens: Math.max(0, Math.round(summary.outputTokens ?? 0)),
    cacheReadTokens,
    cacheWriteTokens,
    hitRate: inputTokens > 0 ? Math.min(1, Math.max(0, cacheReadTokens / inputTokens)) : null
  };
}

/**
 * Display copy for one model option in a selector.
 *
 * `name` leads with the configured alias and otherwise falls back to the
 * humanized provider · model name. The `[PI]` / `[Custom]` routing tag is an
 * internal detail of `buildModelOptions` and never reaches the owner (DESIGN.md:
 * raw model keys and provider protocols are secondary details). `detail` keeps
 * the exact `provider / model-id` so two near-identical models stay tellable
 * apart; it is empty when it would only repeat `name`.
 */
export function modelOptionCopy(option: { key: string; label: string; alias?: string }): { name: string; detail: string } {
  const untagged = option.label.trim().replace(/^\[[^\]]+\]\s*/, "");
  const name = option.alias?.trim() || humanizeModelOption(option.label, option.key).label;
  return { name, detail: untagged === name ? "" : untagged };
}

export interface ModelOptionGroup<T> {
  provider: string;
  options: Array<{ option: T; name: string }>;
}

/** Groups selector options by provider, both levels sorted alphabetically by display name. */
export function groupModelOptions<T extends { key: string; label: string; alias?: string }>(options: T[]): ModelOptionGroup<T>[] {
  const groups = new Map<string, ModelOptionGroup<T>>();
  for (const option of options) {
    const untagged = option.label.trim().replace(/^\[[^\]]+\]\s*/, "");
    const [providerSource, ...modelParts] = untagged.split("/").map((part) => part.trim()).filter(Boolean);
    const keyParts = option.key.split("|");
    const provider = humanizeTechnicalName(providerSource || keyParts[1] || "") || providerSource || keyParts[1] || "—";
    const modelSource = modelParts.join("/") || keyParts.slice(2).join("|") || untagged || option.key;
    const name = option.alias?.trim() || humanizePath(modelSource);
    const groupKey = provider.toLocaleLowerCase();
    const group = groups.get(groupKey) ?? { provider, options: [] };
    group.options.push({ option, name });
    groups.set(groupKey, group);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  return [...groups.values()]
    .sort((a, b) => a.provider.localeCompare(b.provider, undefined, { sensitivity: "base" }))
    .map((group) => ({ ...group, options: [...group.options].sort(byName) }));
}

export function humanizeProviderName(name: string, id: string): { label: string; technicalId: string } {
  const source = name.trim().replace(/^\[[^\]]+\]\s*/, "");
  return {
    label: humanizeTechnicalName(source || id),
    technicalId: id.trim()
  };
}

const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseNumberList(value: string, min: number, max: number): number[] | null {
  const items = value.split(",");
  if (items.length === 0 || items.some((item) => !/^\d+$/.test(item))) return null;
  const numbers = items.map(Number);
  if (numbers.some((item) => item < min || item > max)) return null;
  return [...new Set(numbers)];
}

function times(hours: number[], minute: number, locale: Locale): string {
  const values = hours.map((hour) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  return values.join(locale === "zh-CN" ? "、" : ", ");
}

export function formatNaturalSchedule(schedule: string, locale: Locale): string {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return locale === "zh-CN" ? "自定义计划" : "Custom schedule";
  const [minuteSource, hourSource, monthDay, month, weekdaySource] = fields;
  const minuteStep = /^\*\/(\d+)$/.exec(minuteSource);
  if (minuteStep && hourSource === "*" && monthDay === "*" && month === "*" && weekdaySource === "*") {
    const interval = Number(minuteStep[1]);
    if (interval >= 1 && interval <= 59) return locale === "zh-CN" ? `每 ${interval} 分钟` : `Every ${interval} minutes`;
  }
  const minutes = parseNumberList(minuteSource, 0, 59);
  const hours = parseNumberList(hourSource, 0, 23);
  if (!minutes || minutes.length !== 1 || !hours || month !== "*") {
    return locale === "zh-CN" ? "自定义计划" : "Custom schedule";
  }
  const time = times(hours, minutes[0], locale);
  if (monthDay === "*" && weekdaySource === "*") {
    return locale === "zh-CN" ? `每天 ${time}` : `Daily at ${time}`;
  }
  if (monthDay === "*") {
    const weekdays = parseNumberList(weekdaySource, 0, 6);
    if (weekdays?.length) {
      const labels = weekdays.map((day) => (locale === "zh-CN" ? ZH_WEEKDAYS[day] : EN_WEEKDAYS[day]));
      return locale === "zh-CN" ? `每${labels.join("、")} ${time}` : `${labels.join(", ")} at ${time}`;
    }
  }
  if (weekdaySource === "*" && /^\d+$/.test(monthDay)) {
    const day = Number(monthDay);
    if (day >= 1 && day <= 31) {
      return locale === "zh-CN" ? `每月 ${day} 日 ${time}` : `Monthly on day ${day} at ${time}`;
    }
  }
  return locale === "zh-CN" ? "自定义计划" : "Custom schedule";
}

export function formatNaturalDateTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/** Formats an ISO timestamp in full for detail rows, falling back to the raw value when unparseable. */
export function formatTimestamp(value: string | undefined | null, locale: Locale): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

/** Formats a millisecond duration compactly: 980 -> "980ms", 1500 -> "1.5s", 95_000 -> "1m 35s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(seconds % 60))}s`;
}

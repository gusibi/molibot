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

/** Groups selector options by provider while preserving their source order. */
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
  return [...groups.values()];
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

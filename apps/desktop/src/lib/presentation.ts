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

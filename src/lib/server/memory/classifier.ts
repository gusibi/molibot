import type { MemoryAddInput, MemoryLayer, MemoryRecord } from "./types.js";

export interface MemoryWriteAssessment {
  allowed: boolean;
  reason?: string;
  prepared?: MemoryAddInput;
}

const DURABLE_HINTS = [
  "以后",
  "总是",
  "偏好",
  "我的名字",
  "remember this preference",
  "always",
  "never",
  "prefer",
  "call me",
  "my name is"
];

const REMEMBER_HINTS = [
  "记住",
  "记一下",
  "remember"
];

const DAILY_HINTS = [
  "今天",
  "明天",
  "当前",
  "本周",
  "这次",
  "暂时",
  "today",
  "tomorrow",
  "this session",
  "for now",
  "currently",
  "current"
];

const PROFILE_HINTS = [
  "我叫",
  "我的名字",
  "我是",
  "我的角色",
  "my name is",
  "call me",
  "i am",
  "my role"
];

const PREFERENCE_HINTS = [
  "偏好",
  "喜欢",
  "不喜欢",
  "请用",
  "回复时",
  "prefer",
  "like",
  "dislike"
];

const COLLABORATION_HINTS = [
  "不要",
  "别",
  "请",
  "规则",
  "汇报",
  "keep doing",
  "stop doing",
  "always",
  "never",
  "when replying"
];

const PROJECT_HINTS = [
  "项目",
  "版本",
  "发布",
  "上线",
  "需求",
  "迭代",
  "deadline",
  "release",
  "launch",
  "roadmap",
  "stakeholder"
];

const REFERENCE_HINTS = [
  "http://",
  "https://",
  "slack",
  "linear",
  "jira",
  "notion",
  "grafana",
  "dashboard",
  "文档在",
  "看板",
  "链接"
];

const LIFESTYLE_HINTS = [
  "体重",
  "减脂",
  "热量",
  "卡路里",
  "饮食",
  "睡眠",
  "健身",
  "训练",
  "步数",
  "weight",
  "diet",
  "sleep",
  "workout",
  "calorie",
  "fitness"
];

const SCHEDULING_HINTS = [
  "提醒我",
  "几分钟后",
  "几小时后",
  "明天提醒",
  "every day",
  "every week",
  "remind me",
  "schedule this",
  "cron",
  "one-shot",
  "periodic"
];

const TRANSIENT_EXECUTION_HINTS = [
  "正在处理",
  "processing",
  "thinking",
  "run summary",
  "tool failures",
  "model fallback",
  "exit code",
  "stack trace",
  "traceback",
  "logs:",
  "stdout:",
  "stderr:"
];

function hasHint(text: string, hints: string[]): boolean {
  const lower = text.toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

export function normalizeMemoryContent(input: string): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

export function inferFactKey(content: string): string | null {
  const text = normalizeMemoryContent(content);
  const lower = text.toLowerCase();
  const patterns: Array<{ key: string; re: RegExp }> = [
    { key: "user.name", re: /\b(my name is|call me)\b/i },
    { key: "user.profile", re: /\b(i am|我是|我的角色)\b/i },
    { key: "user.preference", re: /\b(i prefer|prefer|我喜欢|我的偏好)\b/i },
    { key: "user.rule", re: /\b(always|never|以后|总是|不要|别)\b/i },
    { key: "project.context", re: /\b(release|launch|deadline|上线|发布|项目)\b/i },
    { key: "reference.pointer", re: /\b(slack|linear|jira|notion|grafana|dashboard)\b/i }
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(text)) return pattern.key;
  }
  if (lower.startsWith("remember")) return "user.remember";
  return null;
}

export function classifyAutoMemoryCandidate(
  text: string
): { content: string; layer: MemoryLayer; tags: string[] } | null {
  const normalized = normalizeMemoryContent(text);
  if (!normalized || normalized.length < 6) return null;
  if (normalized.length > 500) return null;

  const hasDaily = hasHint(normalized, DAILY_HINTS);
  const hasDurable = hasHint(normalized, DURABLE_HINTS);
  const hasRemember = hasHint(normalized, REMEMBER_HINTS);
  const layer = hasDurable
    ? "long_term"
    : hasDaily
      ? "daily"
      : hasRemember
        ? "long_term"
        : null;
  if (!layer) return null;

  return {
    content: normalized,
    layer,
    tags: inferMemoryTags(normalized, ["flush", "auto", layer])
  };
}

export function inferMemoryTags(content: string, seed: string[] = []): string[] {
  const normalized = normalizeMemoryContent(content);
  const tags = new Set(
    seed
      .map((tag) => String(tag ?? "").trim().toLowerCase())
      .filter(Boolean)
  );

  if (hasHint(normalized, PROFILE_HINTS)) tags.add("class:user_profile");
  if (hasHint(normalized, PREFERENCE_HINTS)) tags.add("class:user_preference");
  if (hasHint(normalized, COLLABORATION_HINTS)) tags.add("class:collaboration");
  if (hasHint(normalized, PROJECT_HINTS)) tags.add("class:project");
  if (hasHint(normalized, REFERENCE_HINTS)) tags.add("class:reference");
  if (hasHint(normalized, LIFESTYLE_HINTS)) tags.add("class:lifestyle");
  if (hasHint(normalized, DAILY_HINTS)) tags.add("class:temporary");

  if (!Array.from(tags).some((tag) => tag.startsWith("class:"))) {
    tags.add("class:general");
  }

  return Array.from(tags);
}

export function prepareMemoryAddInput(input: MemoryAddInput): MemoryAddInput {
  const content = normalizeMemoryContent(input.content);
  const hasDaily = hasHint(content, DAILY_HINTS);
  const hasDurable = hasHint(content, DURABLE_HINTS);
  const hasRemember = hasHint(content, REMEMBER_HINTS);
  const layer =
    input.layer ?? (hasDurable ? "long_term" : hasDaily ? "daily" : hasRemember ? "long_term" : "long_term");
  const tags = inferMemoryTags(content, [...(input.tags ?? []), layer]);
  return {
    ...input,
    content,
    layer,
    tags
  };
}

export function assessMemoryWrite(input: MemoryAddInput): MemoryWriteAssessment {
  const prepared = prepareMemoryAddInput(input);
  const content = prepared.content;
  const lower = content.toLowerCase();

  if (!content || content.length < 8) {
    return { allowed: false, reason: "内容太短，不值得写入长期记忆。" };
  }

  if (content.length > 500) {
    return { allowed: false, reason: "内容太长，更像原始记录，不适合直接写入记忆。" };
  }

  if (hasHint(content, SCHEDULING_HINTS)) {
    return { allowed: false, reason: "提醒、定时、周期任务不应写进记忆，请改用任务/提醒能力。" };
  }

  if (hasHint(lower, TRANSIENT_EXECUTION_HINTS)) {
    return { allowed: false, reason: "运行日志、进度、错误栈这类临时过程信息不应写入记忆。" };
  }

  if (/^(todo|to-do|待办|下一步|next step)\b/i.test(content)) {
    return { allowed: false, reason: "待办和下一步计划属于临时执行过程，不应直接写入记忆。" };
  }

  if (/^https?:\/\/\S+$/i.test(content)) {
    return { allowed: false, reason: "单独一个链接信息太弱，至少补充这个链接的用途再写入记忆。" };
  }

  return { allowed: true, prepared };
}

function memoryPriority(row: MemoryRecord, query: string): number {
  const tags = new Set((row.tags ?? []).map((tag) => tag.toLowerCase()));
  const queryLower = normalizeMemoryContent(query).toLowerCase();
  const queryLifestyle = hasHint(queryLower, LIFESTYLE_HINTS);
  let score = 0;

  if (tags.has("class:collaboration")) score += 12;
  if (tags.has("class:user_preference")) score += 11;
  if (tags.has("class:project")) score += 10;
  if (tags.has("class:reference")) score += 9;
  if (tags.has("class:user_profile")) score += 8;
  if (tags.has("class:general")) score += 3;
  if (tags.has("class:temporary")) score -= 4;
  if (tags.has("class:lifestyle")) score += queryLifestyle ? 4 : -12;

  if (queryLower) {
    const tokens = queryLower.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (row.content.toLowerCase().includes(token)) score += 1;
    }
  }

  return score;
}

export function selectPromptMemoryRows(
  rows: MemoryRecord[],
  query: string,
  limit: number
): { longTerm: MemoryRecord[]; daily: MemoryRecord[] } {
  const sorted = rows
    .slice()
    .sort((a, b) => {
      const scoreDelta = memoryPriority(b, query) - memoryPriority(a, query);
      if (scoreDelta !== 0) return scoreDelta;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const queryLifestyle = hasHint(query, LIFESTYLE_HINTS);
  const eligible = sorted.filter((row) => {
    const tags = new Set((row.tags ?? []).map((tag) => tag.toLowerCase()));
    if (tags.has("class:lifestyle") && !queryLifestyle) return false;
    return true;
  });

  return {
    longTerm: eligible.filter((row) => row.layer === "long_term").slice(0, limit),
    daily: eligible.filter((row) => row.layer === "daily").slice(0, Math.min(2, limit))
  };
}

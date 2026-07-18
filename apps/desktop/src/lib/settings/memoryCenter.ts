import type { DesktopMemoryCandidate, DesktopMemoryItem, DesktopMemoryProfile } from "@molibot/desktop-contract";

export const MEMORY_TOPIC_IDS = ["projects", "technology", "design", "wellness", "content", "habits"] as const;
export type MemoryTopicId = (typeof MEMORY_TOPIC_IDS)[number];

export interface MemoryTopicProjection {
  id: MemoryTopicId;
  items: DesktopMemoryItem[];
  relatedEntities: MemoryRelatedEntity[];
  updatedAt: string;
}

export interface MemoryRelatedEntity {
  label: string;
  detail: string;
  count: number;
}

export interface MemoryCenterProjection {
  summary: string;
  summarySourceCount: number;
  profileMeta?: DesktopMemoryProfile["meta"];
  currentFocus: DesktopMemoryItem[];
  stablePreferences: DesktopMemoryItem[];
  recentItems: DesktopMemoryItem[];
  attentionItems: DesktopMemoryItem[];
  pendingCandidates: DesktopMemoryCandidate[];
  topics: MemoryTopicProjection[];
}

export interface MemoryCandidateGroups {
  aboutOwner: DesktopMemoryCandidate[];
  agentLearnings: DesktopMemoryCandidate[];
}

// Owner/project candidates shape the user's own profile and deserve attention
// first; agent_self/content candidates are runtime learnings and stay collapsed.
export function splitPendingCandidates(candidates: DesktopMemoryCandidate[]): MemoryCandidateGroups {
  const aboutOwner: DesktopMemoryCandidate[] = [];
  const agentLearnings: DesktopMemoryCandidate[] = [];
  for (const candidate of candidates) {
    (candidate.domain === "agent_self" || candidate.domain === "content" ? agentLearnings : aboutOwner).push(candidate);
  }
  return { aboutOwner, agentLearnings };
}

const TOPIC_TERMS: Record<MemoryTopicId, string[]> = {
  projects: ["project", "product", "molibot", "项目", "产品", "里程碑", "客户端", "agent"],
  technology: ["technology", "technical", "stack", "code", "svelte", "tauri", "typescript", "rust", "node", "golang", "技术", "开发", "代码", "架构"],
  design: ["design", "ui", "ux", "macos", "apple", "视觉", "设计", "界面", "原生", "交互"],
  wellness: ["fitness", "workout", "health", "weight", "diet", "emom", "训练", "健康", "体重", "减脂", "饮食", "心率"],
  content: ["content", "writing", "article", "paper", "公众号", "文章", "写作", "内容", "素材", "创作"],
  habits: ["habit", "routine", "personal", "lifestyle", "preference", "daily", "习惯", "日常", "偏好", "生活", "个人"]
};

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRecent(left: DesktopMemoryItem, right: DesktopMemoryItem): number {
  return timestamp(right.updatedAt) - timestamp(left.updatedAt);
}

function normalizedText(item: DesktopMemoryItem): string {
  return [item.domain, item.type, item.subject, ...item.tags, item.content].filter(Boolean).join(" ").toLowerCase();
}

export function memoryTopicFor(item: DesktopMemoryItem): MemoryTopicId {
  if (item.domain === "project") return "projects";
  if (item.domain === "content") return "content";
  const text = normalizedText(item);
  const ordered: MemoryTopicId[] = ["wellness", "design", "technology", "content", "projects", "habits"];
  for (const topic of ordered) {
    if (TOPIC_TERMS[topic].some((term) => text.includes(term))) return topic;
  }
  if (item.type === "skill") return "technology";
  if (item.type === "task" || item.type === "event") return "projects";
  return "habits";
}

export function compactMemoryText(value: string, maxLength = 120): string {
  const clean = value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/gm, "")
    .replace(/[#`*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function retentionScore(item: DesktopMemoryItem): number {
  let score = item.layer === "long_term" ? 20 : 0;
  if (item.pinned) score += 12;
  if (item.type === "user_preference" || item.type === "user_fact") score += 8;
  if (item.domain === "owner" || item.domain === "project") score += 5;
  if (item.allowInjection === false) score -= 12;
  if (item.hasConflict) score -= 10;
  if (item.expiresAt && timestamp(item.expiresAt) <= Date.now()) score -= 14;
  score += Math.min(5, item.sources?.length ?? 0);
  if (typeof item.confidence === "number") score += item.confidence * 5;
  return score;
}

function buildSummary(items: DesktopMemoryItem[]): string {
  const seenTopics = new Set<MemoryTopicId>();
  const selected = [...items]
    .filter((item) => item.layer === "long_term" && !item.hasConflict && item.allowInjection !== false)
    .sort((left, right) => retentionScore(right) - retentionScore(left) || compareRecent(left, right))
    .filter((item) => {
      const topic = memoryTopicFor(item);
      if (seenTopics.has(topic)) return false;
      seenTopics.add(topic);
      return true;
    })
    .slice(0, 3)
    .map((item) => compactMemoryText(item.content, 96))
    .filter(Boolean);
  return selected.join("；");
}

function isStablePreference(item: DesktopMemoryItem): boolean {
  if (item.type === "user_preference") return true;
  if (item.tags.some((tag) => /^(?:preference|style|habit|偏好|风格|习惯)(?::|$)/i.test(tag.trim()))) return true;
  return /(?:喜欢|偏好|习惯|不喜欢|更喜欢|prefer|preference)/i.test(item.content);
}

function buildRelatedEntities(items: DesktopMemoryItem[]): MemoryRelatedEntity[] {
  const genericTags = new Set(["long_term", "short_term", "daily", "owner", "task", "event", "user_fact", "user_preference"]);
  const entities = new Map<string, { label: string; detail: string; count: number }>();
  for (const item of items) {
    const labels = item.tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 2 && tag.length <= 28 && !genericTags.has(tag.toLocaleLowerCase()) && !tag.toLocaleLowerCase().startsWith("class:"))
      .slice(0, 4);
    for (const label of labels) {
      const key = label.toLocaleLowerCase();
      const existing = entities.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        entities.set(key, { label, detail: compactMemoryText(item.content, 54), count: 1 });
      }
    }
  }
  return [...entities.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 2);
}

export function projectMemoryCenter(
  items: DesktopMemoryItem[],
  candidates: DesktopMemoryCandidate[],
  profile?: DesktopMemoryProfile | null
): MemoryCenterProjection {
  const recentItems = [...items].sort(compareRecent);
  const topicMap = new Map<MemoryTopicId, DesktopMemoryItem[]>(MEMORY_TOPIC_IDS.map((id) => [id, []]));
  for (const item of recentItems) topicMap.get(memoryTopicFor(item))!.push(item);

  const explicitFocus = recentItems
    .filter((item) => item.domain === "project" || item.tags.some((tag) => /current|goal|project|当前|目标|项目/i.test(tag)) || /(?:正在|当前目标|下一步|计划|building|developing)/i.test(item.content))
    .slice(0, 4);
  const stablePreferences = recentItems
    .filter(isStablePreference)
    .filter((item) => !item.hasConflict && item.allowInjection !== false)
    .slice(0, 6);
  const attentionItems = recentItems
    .filter((item) => item.hasConflict || item.allowInjection === false || (item.expiresAt && timestamp(item.expiresAt) <= Date.now()))
    .slice(0, 4);
  const summary = profile?.summary ?? buildSummary(recentItems);

  return {
    summary,
    summarySourceCount: profile?.meta.stablePreferences.scannedCount ?? recentItems.filter((item) => item.layer === "long_term").length,
    profileMeta: profile?.meta,
    currentFocus: profile?.currentFocus ?? (explicitFocus.length > 0 ? explicitFocus : topicMap.get("projects")!.slice(0, 4)),
    stablePreferences: profile?.stablePreferences ?? stablePreferences,
    recentItems: profile?.recentItems ?? recentItems.slice(0, 5),
    attentionItems: profile?.attentionItems ?? attentionItems,
    pendingCandidates: [...candidates].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt)),
    topics: MEMORY_TOPIC_IDS.map((id) => ({
      id,
      items: topicMap.get(id)!,
      relatedEntities: buildRelatedEntities(topicMap.get(id)!),
      updatedAt: topicMap.get(id)?.[0]?.updatedAt ?? ""
    }))
  };
}

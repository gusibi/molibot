/**
 * moryPlanner.ts
 *
 * Retrieval routing and intent planning:
 *   query -> intent -> memory type/path scope
 */

import type { MemoryType } from "./morySchema.js";

export type RetrievalIntent =
  | "chat"
  | "work"
  | "learning"
  | "incident"
  | "profile";

export interface RetrievalPlan {
  intent: RetrievalIntent;
  memoryTypes: MemoryType[];
  pathPrefixes: string[];
  topK: number;
  rationale: string;
}

export interface PlannerOptions {
  defaultTopK?: number;
  workTopK?: number;
  chatTopK?: number;
  pathNamespace?: string;
}

const INTENT_HINTS: Record<RetrievalIntent, string[]> = {
  chat: ["随便聊", "聊天", "最近", "today", "today's", "just chat"],
  work: ["项目", "任务", "debug", "fix", "deploy", "roadmap", "实现", "方案"],
  learning: ["学习", "教程", "how to", "example", "最佳实践", "best practice"],
  incident: ["事故", "故障", "报错", "incident", "error", "宕机", "异常"],
  profile: ["我喜欢", "偏好", "我的", "my preference", "my name", "call me"],
};

function hasAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(hint.toLowerCase()));
}

export function inferRetrievalIntent(query: string): RetrievalIntent {
  const q = query.toLowerCase();
  if (hasAny(q, INTENT_HINTS.incident)) return "incident";
  if (hasAny(q, INTENT_HINTS.work)) return "work";
  if (hasAny(q, INTENT_HINTS.learning)) return "learning";
  if (hasAny(q, INTENT_HINTS.profile)) return "profile";
  if (hasAny(q, INTENT_HINTS.chat)) return "chat";
  return "chat";
}

function prefixed(namespace: string, path: string): string {
  return namespace ? `${namespace}${path}` : path;
}

export function buildRetrievalPlan(
  query: string,
  options: PlannerOptions = {}
): RetrievalPlan {
  const intent = inferRetrievalIntent(query);
  const namespace = options.pathNamespace ?? "";
  const defaultTopK = options.defaultTopK ?? 8;
  const chatTopK = options.chatTopK ?? 6;
  const workTopK = options.workTopK ?? 10;

  switch (intent) {
    case "work":
      return {
        intent,
        memoryTypes: ["task", "skill", "event", "user_preference"],
        pathPrefixes: [
          prefixed(namespace, "mory://task/"),
          prefixed(namespace, "mory://skill/"),
          prefixed(namespace, "mory://event/"),
          prefixed(namespace, "mory://user_preference/"),
        ],
        topK: workTopK,
        rationale: "Work query: prioritize task state, skills, and relevant incidents",
      };
    case "learning":
      return {
        intent,
        memoryTypes: ["skill", "world_knowledge", "task"],
        pathPrefixes: [
          prefixed(namespace, "mory://skill/"),
          prefixed(namespace, "mory://world_knowledge/"),
          prefixed(namespace, "mory://task/"),
        ],
        topK: defaultTopK,
        rationale: "Learning query: prioritize skills and reusable knowledge",
      };
    case "incident":
      return {
        intent,
        memoryTypes: ["event", "task", "world_knowledge"],
        pathPrefixes: [
          prefixed(namespace, "mory://event/"),
          prefixed(namespace, "mory://task/"),
          prefixed(namespace, "mory://world_knowledge/"),
        ],
        topK: defaultTopK,
        rationale: "Incident query: prioritize event timeline and operational context",
      };
    case "profile":
      return {
        intent,
        memoryTypes: ["user_preference", "user_fact", "task"],
        pathPrefixes: [
          prefixed(namespace, "mory://user_preference/"),
          prefixed(namespace, "mory://user_fact/"),
          prefixed(namespace, "mory://task/current"),
        ],
        topK: chatTopK,
        rationale: "Profile query: prioritize stable preferences and user facts",
      };
    case "chat":
    default:
      return {
        intent: "chat",
        memoryTypes: ["user_preference", "user_fact", "event"],
        pathPrefixes: [
          prefixed(namespace, "mory://user_preference/"),
          prefixed(namespace, "mory://user_fact/"),
          prefixed(namespace, "mory://event/"),
        ],
        topK: chatTopK,
        rationale: "General chat: prioritize personalization and recent events",
      };
  }
}

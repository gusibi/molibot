/**
 * moryWorkspace.ts
 *
 * Task-scoped working memory helpers.
 */

import type { CanonicalMemory } from "./morySchema.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

export function buildWorkspacePath(sessionId: string, key = "state"): string {
  const sid = slugify(sessionId);
  const k = slugify(key);
  return `mory://task/session.${sid}.${k}`;
}

export function isWorkspacePath(path: string): boolean {
  return path.startsWith("mory://task/session.");
}

export function shouldExpireWorkingMemory(
  updatedAt: string,
  ttlHours = 24
): boolean {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return false;
  const ttlMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
  return Date.now() - ts > ttlMs;
}

export function toWorkingMemory(
  payload: Omit<CanonicalMemory, "path" | "type" | "updatedPolicy">,
  sessionId: string,
  key = "state"
): CanonicalMemory {
  return {
    ...payload,
    path: buildWorkspacePath(sessionId, key),
    type: "task",
    updatedPolicy: "overwrite",
    importance: payload.importance ?? 0.7,
    utility: payload.utility ?? 0.9,
  };
}

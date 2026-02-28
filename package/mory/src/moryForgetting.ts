/**
 * moryForgetting.ts
 *
 * Forget/archive policy engine.
 */

import type { PersistedMemoryNode, StorageAdapter } from "./moryAdapter.js";

export interface ForgettingPolicy {
  capacity: number;
  minRetentionScore?: number;
  halfLifeDays?: number;
}

export interface ForgettingPlan {
  keep: PersistedMemoryNode[];
  archive: PersistedMemoryNode[];
  archivedIds: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function recencyWeight(updatedAt: string, halfLifeDays: number): number {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return 0.2;
  const ageDays = Math.max(0, (Date.now() - ts) / 86400000);
  const lambda = Math.log(2) / Math.max(1, halfLifeDays);
  return Math.exp(-lambda * ageDays);
}

function frequencyWeight(accessCount: number): number {
  return clamp01(Math.log(1 + Math.max(0, accessCount)) / Math.log(21));
}

export function retentionScore(node: PersistedMemoryNode, halfLifeDays = 21): number {
  const recency = recencyWeight(node.updatedAt, halfLifeDays);
  const frequency = frequencyWeight(node.accessCount);
  return clamp01(
    clamp01(node.importance) * 0.45 +
    clamp01(node.confidence) * 0.15 +
    frequency * 0.2 +
    recency * 0.2
  );
}

export function planForgetting(
  nodes: PersistedMemoryNode[],
  policy: ForgettingPolicy
): ForgettingPlan {
  if (nodes.length <= policy.capacity) {
    return { keep: nodes, archive: [], archivedIds: [] };
  }

  const minRetentionScore = policy.minRetentionScore ?? 0.25;
  const halfLifeDays = policy.halfLifeDays ?? 21;

  const scored = nodes
    .map((node) => ({ node, score: retentionScore(node, halfLifeDays) }))
    .sort((a, b) => b.score - a.score);

  const keep: PersistedMemoryNode[] = [];
  const archive: PersistedMemoryNode[] = [];

  for (const item of scored) {
    if (keep.length < policy.capacity && item.score >= minRetentionScore) {
      keep.push(item.node);
      continue;
    }
    archive.push(item.node);
  }

  return {
    keep,
    archive,
    archivedIds: archive.map((a) => a.id),
  };
}

export async function applyForgettingPolicy(
  storage: StorageAdapter,
  userId: string,
  policy: ForgettingPolicy
): Promise<ForgettingPlan> {
  const rows = await storage.list(userId, {
    includeArchived: false,
    limit: Math.max(policy.capacity * 5, 200),
  });
  const plan = planForgetting(rows, policy);
  if (plan.archivedIds.length > 0) {
    await storage.archive(userId, plan.archivedIds);
  }
  return plan;
}

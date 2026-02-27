/**
 * moryConsolidation.ts
 *
 * Episodic -> semantic consolidation helpers.
 */

import type { CanonicalMemory } from "./morySchema.js";
import { jaccardSimilarity, overlapSimilarity } from "./moryWriteGate.js";

export interface EpisodicMemory {
  id: string;
  path: string;
  type: CanonicalMemory["type"];
  subject: string;
  value: string;
  confidence: number;
  observedAt?: string;
}

export interface ConsolidatedRule {
  path: string;
  type: CanonicalMemory["type"];
  subject: string;
  summary: string;
  confidence: number;
  supportCount: number;
  sourceIds: string[];
}

export interface ConsolidationOptions {
  minSupport?: number;
  similarityThreshold?: number;
}

function combinedSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), overlapSimilarity(a, b));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function centroidValue(values: string[]): string {
  if (values.length === 1) return values[0];

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      if (i === j) continue;
      sum += combinedSimilarity(values[i], values[j]);
    }
    if (sum > bestScore) {
      bestScore = sum;
      bestIdx = i;
    }
  }
  return values[bestIdx];
}

export function consolidateEpisodes(
  episodes: EpisodicMemory[],
  options: ConsolidationOptions = {}
): ConsolidatedRule[] {
  const minSupport = options.minSupport ?? 2;
  const similarityThreshold = options.similarityThreshold ?? 0.45;
  if (episodes.length === 0) return [];

  const grouped = new Map<string, EpisodicMemory[]>();
  for (const ep of episodes) {
    const key = `${ep.path}::${ep.subject}::${ep.type}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(ep);
    grouped.set(key, bucket);
  }

  const rules: ConsolidatedRule[] = [];

  for (const bucket of grouped.values()) {
    if (bucket.length < minSupport) continue;

    // keep only mutually related samples for robust consolidation
    const related: EpisodicMemory[] = [];
    for (const item of bucket) {
      const hasPeer = bucket.some(
        (other) => other.id !== item.id && combinedSimilarity(item.value, other.value) >= similarityThreshold
      );
      if (hasPeer) related.push(item);
    }
    if (related.length < minSupport) continue;

    const values = related.map((r) => r.value);
    const summary = centroidValue(values);
    const avgConfidence =
      related.reduce((sum, item) => sum + item.confidence, 0) / related.length;
    const confidence = clamp01(avgConfidence + Math.min(0.15, Math.log(1 + related.length) / 20));

    const first = related[0];
    rules.push({
      path: first.path,
      type: first.type,
      subject: first.subject,
      summary,
      confidence,
      supportCount: related.length,
      sourceIds: related.map((r) => r.id),
    });
  }

  return rules.sort((a, b) => b.supportCount - a.supportCount || b.confidence - a.confidence);
}

export function toCanonicalFromRule(rule: ConsolidatedRule): CanonicalMemory {
  return {
    path: rule.path,
    type: rule.type,
    subject: rule.subject,
    value: rule.summary,
    confidence: rule.confidence,
    updatedPolicy: rule.type === "user_preference" || rule.type === "user_fact"
      ? "overwrite"
      : "merge_append",
    importance: Math.min(1, 0.5 + (rule.supportCount / 10)),
    utility: rule.type === "task" ? 0.9 : 0.7,
    title: `${rule.subject}`,
  };
}

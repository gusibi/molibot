/**
 * moryScoring.ts
 *
 * Write-gate scoring model inspired by:
 *   score = importance * novelty * utility * confidence
 *
 * We expose both multiplicative and weighted modes.
 * - Multiplicative mode is strict and penalizes weak dimensions heavily.
 * - Weighted mode is smoother and easier to tune in production.
 */

import type { CanonicalMemory, MemoryType } from "./morySchema.js";
import type { StoredMemoryNode } from "./moryWriteGate.js";
import { jaccardSimilarity, overlapSimilarity } from "./moryWriteGate.js";

export interface ScoreWeights {
  importance: number;
  novelty: number;
  utility: number;
  confidence: number;
}

export interface ScoreComponents {
  importance: number;
  novelty: number;
  utility: number;
  confidence: number;
}

export interface GateScoreOptions {
  /**
   * Scoring mode:
   * - "product": strict multiplicative score
   * - "weighted": weighted average
   */
  mode?: "product" | "weighted";
  threshold?: number;
  minNovelty?: number;
  weights?: Partial<ScoreWeights>;
}

export interface GateScoreResult {
  score: number;
  shouldWrite: boolean;
  threshold: number;
  components: ScoreComponents;
  mode: "product" | "weighted";
  reason: string;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  importance: 0.3,
  novelty: 0.35,
  utility: 0.2,
  confidence: 0.15,
};

const TYPE_IMPORTANCE_PRIOR: Record<MemoryType, number> = {
  user_preference: 0.9,
  user_fact: 0.85,
  skill: 0.7,
  event: 0.55,
  task: 0.8,
  world_knowledge: 0.5,
};

const TYPE_UTILITY_PRIOR: Record<MemoryType, number> = {
  user_preference: 0.95,
  user_fact: 0.85,
  skill: 0.75,
  event: 0.5,
  task: 0.9,
  world_knowledge: 0.45,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function combinedSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), overlapSimilarity(a, b));
}

export function deriveNovelty(existing: StoredMemoryNode[], incomingValue: string): number {
  if (existing.length === 0) return 1;
  let maxSimilarity = 0;
  for (const node of existing) {
    const similarity = combinedSimilarity(node.value, incomingValue);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }
  return clamp01(1 - maxSimilarity);
}

export function deriveImportance(memory: CanonicalMemory): number {
  if (typeof memory.importance === "number") return clamp01(memory.importance);
  return TYPE_IMPORTANCE_PRIOR[memory.type];
}

export function deriveUtility(memory: CanonicalMemory): number {
  if (typeof memory.utility === "number") return clamp01(memory.utility);
  return TYPE_UTILITY_PRIOR[memory.type];
}

function weightedScore(components: ScoreComponents, weights: ScoreWeights): number {
  const total =
    weights.importance + weights.novelty + weights.utility + weights.confidence;
  if (total <= 0) return 0;
  return (
    components.importance * weights.importance +
    components.novelty * weights.novelty +
    components.utility * weights.utility +
    components.confidence * weights.confidence
  ) / total;
}

function productScore(components: ScoreComponents): number {
  return (
    components.importance *
    components.novelty *
    components.utility *
    components.confidence
  );
}

export function scoreWriteCandidate(
  existing: StoredMemoryNode[],
  incoming: CanonicalMemory,
  options: GateScoreOptions = {}
): GateScoreResult {
  const mode = options.mode ?? "weighted";
  const threshold = options.threshold ?? (mode === "product" ? 0.18 : 0.58);
  const minNovelty = options.minNovelty ?? 0.05;

  const components: ScoreComponents = {
    importance: deriveImportance(incoming),
    novelty: deriveNovelty(existing, incoming.value),
    utility: deriveUtility(incoming),
    confidence: clamp01(incoming.confidence),
  };

  if (components.novelty < minNovelty) {
    return {
      score: 0,
      shouldWrite: false,
      threshold,
      components,
      mode,
      reason: `Novelty ${components.novelty.toFixed(2)} below minimum ${minNovelty.toFixed(2)}`,
    };
  }

  const mergedWeights: ScoreWeights = {
    ...DEFAULT_WEIGHTS,
    ...(options.weights ?? {}),
  };
  const rawScore = mode === "product"
    ? productScore(components)
    : weightedScore(components, mergedWeights);
  const score = clamp01(rawScore);
  const shouldWrite = score >= threshold;

  return {
    score,
    shouldWrite,
    threshold,
    components,
    mode,
    reason: shouldWrite
      ? `Score ${score.toFixed(2)} >= threshold ${threshold.toFixed(2)}`
      : `Score ${score.toFixed(2)} < threshold ${threshold.toFixed(2)}`,
  };
}

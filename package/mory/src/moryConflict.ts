/**
 * moryConflict.ts
 *
 * Deterministic conflict resolution and versioning helpers.
 */

import type { CanonicalMemory } from "./morySchema.js";
import type { StoredMemoryNode } from "./moryWriteGate.js";
import { jaccardSimilarity, overlapSimilarity } from "./moryWriteGate.js";

export interface VersionedMemoryNode extends StoredMemoryNode {
  version: number;
  subject?: string;
  source?: string;
  observedAt?: string;
  supersedes?: string;
  conflictFlag?: boolean;
}

export type ConflictAction =
  | "keep_existing"
  | "replace_existing"
  | "merge"
  | "flag_conflict";

export interface ConflictResolution {
  action: ConflictAction;
  conflict: boolean;
  reason: string;
  /**
   * Applied when action is "replace_existing" or "merge".
   * This represents the next version snapshot.
   */
  next?: VersionedMemoryNode;
}

export interface ConflictResolveOptions {
  dedupeThreshold?: number;
  contradictionThreshold?: number;
  confidenceEpsilon?: number;
}

const NEGATIVE_MARKERS = [
  "not",
  "never",
  "don't",
  "cannot",
  "can't",
  "不",
  "没",
  "不是",
  "不要",
  "不喜欢",
];

function hasNegativeMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return NEGATIVE_MARKERS.some((m) => lower.includes(m));
}

function looksContradictory(a: string, b: string, threshold: number): boolean {
  const overlap = Math.max(jaccardSimilarity(a, b), overlapSimilarity(a, b));
  if (overlap < threshold) return false;
  const polarityA = hasNegativeMarker(a);
  const polarityB = hasNegativeMarker(b);
  return polarityA !== polarityB;
}

function toMillis(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function mergeValues(existing: string, incoming: string): string {
  if (existing.includes(incoming)) return existing;
  if (incoming.includes(existing)) return incoming;
  return `${existing.trimEnd()}；${incoming.trimStart()}`;
}

export function resolveMemoryConflict(
  existing: VersionedMemoryNode,
  incoming: CanonicalMemory,
  options: ConflictResolveOptions = {}
): ConflictResolution {
  const dedupeThreshold = options.dedupeThreshold ?? 0.92;
  const contradictionThreshold = options.contradictionThreshold ?? 0.48;
  const confidenceEpsilon = options.confidenceEpsilon ?? 0.02;

  const similarity = Math.max(
    jaccardSimilarity(existing.value, incoming.value),
    overlapSimilarity(existing.value, incoming.value)
  );
  const incomingObserved = toMillis(incoming.observedAt);
  const existingObserved = toMillis(existing.observedAt ?? existing.updatedAt);
  const incomingIsNewer = incomingObserved > 0 && incomingObserved >= existingObserved;

  if (similarity >= dedupeThreshold) {
    return {
      action: "keep_existing",
      conflict: false,
      reason: `Near-duplicate values (similarity=${similarity.toFixed(2)})`,
    };
  }

  if (looksContradictory(existing.value, incoming.value, contradictionThreshold)) {
    const preferIncoming = incoming.confidence > existing.confidence + confidenceEpsilon || incomingIsNewer;
    if (preferIncoming && incoming.updatedPolicy !== "skip") {
      return {
        action: "replace_existing",
        conflict: true,
        reason: "Contradiction detected; incoming chosen by confidence/recency",
        next: {
          ...existing,
          value: incoming.value,
          confidence: incoming.confidence,
          observedAt: incoming.observedAt ?? new Date().toISOString(),
          source: incoming.source,
          updatedAt: new Date().toISOString(),
          supersedes: existing.id,
          version: existing.version + 1,
          conflictFlag: true,
        },
      };
    }
    return {
      action: "flag_conflict",
      conflict: true,
      reason: "Contradiction detected; existing retained",
    };
  }

  switch (incoming.updatedPolicy) {
    case "overwrite":
      return {
        action: "replace_existing",
        conflict: false,
        reason: "Policy overwrite",
        next: {
          ...existing,
          value: incoming.value,
          confidence: incoming.confidence,
          observedAt: incoming.observedAt ?? new Date().toISOString(),
          source: incoming.source,
          updatedAt: new Date().toISOString(),
          supersedes: existing.id,
          version: existing.version + 1,
          conflictFlag: false,
        },
      };
    case "highest_confidence":
      if (incoming.confidence > existing.confidence + confidenceEpsilon) {
        return {
          action: "replace_existing",
          conflict: false,
          reason: "Incoming confidence is higher",
          next: {
            ...existing,
            value: incoming.value,
            confidence: incoming.confidence,
            observedAt: incoming.observedAt ?? new Date().toISOString(),
            source: incoming.source,
            updatedAt: new Date().toISOString(),
            supersedes: existing.id,
            version: existing.version + 1,
            conflictFlag: false,
          },
        };
      }
      return {
        action: "keep_existing",
        conflict: false,
        reason: "Existing confidence is higher",
      };
    case "merge_append":
      return {
        action: "merge",
        conflict: false,
        reason: "Policy merge_append",
        next: {
          ...existing,
          value: mergeValues(existing.value, incoming.value),
          confidence: Math.max(existing.confidence, incoming.confidence),
          observedAt: incoming.observedAt ?? existing.observedAt,
          source: incoming.source ?? existing.source,
          updatedAt: new Date().toISOString(),
          supersedes: existing.id,
          version: existing.version + 1,
          conflictFlag: false,
        },
      };
    case "skip":
      return {
        action: "keep_existing",
        conflict: false,
        reason: "Policy skip",
      };
    default: {
      const _unreachable: never = incoming.updatedPolicy;
      return {
        action: "keep_existing",
        conflict: false,
        reason: `Unsupported policy ${String(_unreachable)}`,
      };
    }
  }
}

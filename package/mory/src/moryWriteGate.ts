/**
 * moryWriteGate.ts
 *
 * Novelty detection + conflict resolution write gate for the mory:// system.
 *
 * Before any memory is persisted, this module decides whether to:
 *   - INSERT  (genuinely new information)
 *   - UPDATE  (merge/overwrite existing at same path)
 *   - SKIP    (duplicate or below-threshold novelty — do not write)
 *
 * Design principles:
 *   - No LLM calls, no network — pure deterministic functions
 *   - Token-level Jaccard similarity (fast, no embedding required)
 *   - Policy-aware: respects CanonicalMemory.updatedPolicy
 *   - Fully typed, unit-testable
 */

import type { CanonicalMemory, UpdatePolicy } from "./morySchema.js";

// ---------------------------------------------------------------------------
// Internal types (not exported by index — internal to write gate)
// ---------------------------------------------------------------------------

/** Minimal shape of a stored memory record needed by the write gate */
export interface StoredMemoryNode {
    id: string;
    moryPath: string;
    value: string;          // corresponds to l1_summary / content
    confidence: number;
    updatedAt: string;      // ISO-8601
}

// ---------------------------------------------------------------------------
// Write Decision
// ---------------------------------------------------------------------------

export type WriteAction = "insert" | "update" | "skip";

export interface InsertDecision {
    action: "insert";
}

export interface UpdateDecision {
    action: "update";
    /** The existing record that should be updated */
    target: StoredMemoryNode;
    /** Fields to merge/overwrite on the target */
    patch: Partial<Pick<StoredMemoryNode, "value" | "confidence" | "updatedAt">>;
    /** Human-readable explanation for debugging */
    reason: string;
}

export interface SkipDecision {
    action: "skip";
    /** Human-readable explanation for debugging */
    reason: string;
    /** The existing record that is semantically equivalent */
    duplicate?: StoredMemoryNode;
}

export type WriteDecision = InsertDecision | UpdateDecision | SkipDecision;

// ---------------------------------------------------------------------------
// Similarity computation
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were",
    "and", "or", "of", "to", "in", "on", "at",
    "user", "users", "i", "my", "me", "we",
    "的", "了", "是", "在", "和", "我", "用户",
]);

/**
 * Tokenize a string into lowercased meaningful tokens.
 *
 * For Latin text: splits on whitespace/punctuation.
 * For CJK text: also splits each character individually (unigrams),
 * since CJK words are not space-delimited and character-level overlap
 * provides better Jaccard signals than whole-word matching.
 */
function tokenize(text: string): string[] {
    // Normalize punctuation
    const normalized = text
        .toLowerCase()
        .replace(/[，。！？；：""''【】（）《》、]/g, " ");

    const tokens: string[] = [];

    // Split into chunks on whitespace + latin punctuation
    const chunks = normalized
        .replace(/[^a-z0-9\u4e00-\u9fff\s_.-]/g, " ")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

    for (const chunk of chunks) {
        if (STOP_WORDS.has(chunk)) continue;
        // Check if chunk contains CJK characters
        if (/[\u4e00-\u9fff]/.test(chunk)) {
            // Add the whole chunk AND each individual CJK character
            // This improves overlap detection for semantically related sentences
            for (const char of chunk) {
                if (/[\u4e00-\u9fff]/.test(char) && !STOP_WORDS.has(char)) {
                    tokens.push(char);
                }
            }
            // Also add as a whole token if it's a meaningful word (2+ chars)
            if (chunk.length >= 2 && !STOP_WORDS.has(chunk)) {
                tokens.push(chunk);
            }
        } else {
            // ASCII: require length >= 1
            if (chunk.length >= 1 && !STOP_WORDS.has(chunk)) {
                tokens.push(chunk);
            }
        }
    }
    return tokens;
}

/**
 * Jaccard similarity between the token-sets of two strings. Range: [0, 1].
 *
 * 1.0 = identical token sets
 * 0.0 = completely disjoint
 */
export function jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(tokenize(a));
    const setB = new Set(tokenize(b));

    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}


/**
 * Overlap coefficient (one-sided Jaccard).
 * Better for cases where one text is a subset of the other.
 *
 * overlap(A, B) = |A ∩ B| / min(|A|, |B|)
 */
export function overlapSimilarity(a: string, b: string): number {
    const setA = new Set(tokenize(a));
    const setB = new Set(tokenize(b));

    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection++;
    }
    return intersection / Math.min(setA.size, setB.size);
}

/**
 * Combined similarity: max of Jaccard and overlap.
 * Catches both exact-ish duplicates and subset cases.
 */
function combinedSimilarity(a: string, b: string): number {
    return Math.max(jaccardSimilarity(a, b), overlapSimilarity(a, b));
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

interface ScoredCandidate {
    node: StoredMemoryNode;
    similarity: number;
}

/**
 * Find all existing nodes that are semantically similar (above threshold)
 * to the incoming memory, sorted descending by similarity.
 */
export function findSimilarNodes(
    existing: StoredMemoryNode[],
    incoming: Pick<CanonicalMemory, "value">,
    threshold = 0.75
): ScoredCandidate[] {
    return existing
        .map((node) => ({
            node,
            similarity: combinedSimilarity(node.value, incoming.value),
        }))
        .filter((sc) => sc.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Merge two value strings by appending the delta (what's new in `incoming`).
 * Avoids hard duplication of shared tokens.
 */
function mergeValues(existing: string, incoming: string): string {
    const existTokens = new Set(tokenize(existing));
    const incomingTokens = tokenize(incoming);
    const novel = incomingTokens.filter((t) => !existTokens.has(t));

    if (novel.length === 0) return existing; // Nothing to add

    // Append novel info as a clause
    return `${existing.trimEnd()}；${incoming.trimEnd()}`;
}

// ---------------------------------------------------------------------------
// Core decision function
// ---------------------------------------------------------------------------

/**
 * Decide whether to INSERT, UPDATE, or SKIP based on the incoming canonical
 * memory and the existing nodes at the same mory:// path.
 *
 * @param existing     Existing stored nodes at the same `moryPath`
 * @param incoming     The canonical memory proposed for writing
 * @param options.similarityThreshold  Jaccard threshold above which we consider
 *                     two memories "similar enough to reconcile" (default 0.75)
 * @param options.dedupeThreshold      Jaccard threshold above which we consider
 *                     two memories "effectively identical" and skip (default 0.90)
 */
export function decideWrite(
    existing: StoredMemoryNode[],
    incoming: CanonicalMemory,
    options: { similarityThreshold?: number; dedupeThreshold?: number } = {}
): WriteDecision {
    // Lower defaults account for CJK character-level overlap:
    //   0.30 threshold catches semantically similar memories (same topic, diff value)
    //   0.80 threshold catches near-duplicates (same topic, same value)
    const { similarityThreshold = 0.30, dedupeThreshold = 0.80 } = options;

    // ── No existing nodes at this path → always insert ───────────────────────
    if (existing.length === 0) {
        return { action: "insert" };
    }

    const now = new Date().toISOString();
    const policy: UpdatePolicy = incoming.updatedPolicy;

    // ── Find similar candidates ───────────────────────────────────────────────
    const similar = findSimilarNodes(existing, incoming, similarityThreshold);
    const identical = similar.filter((sc) => sc.similarity >= dedupeThreshold);

    // ── 1. Pure duplicate → skip (unless policy=merge_append, which always merges) ─
    if (identical.length > 0 && policy !== "merge_append") {
        const best = identical[0];
        return {
            action: "skip",
            reason: `Duplicate detected (similarity=${best.similarity.toFixed(2)}) — value already stored`,
            duplicate: best.node,
        };
    }

    // ── 2. Similar but not identical ─────────────────────────────────────────
    if (similar.length > 0) {
        const bestMatch = similar[0];

        switch (policy) {
            // Newer value always wins
            case "overwrite":
                return {
                    action: "update",
                    target: bestMatch.node,
                    patch: {
                        value: incoming.value,
                        confidence: incoming.confidence,
                        updatedAt: now,
                    },
                    reason: `Policy=overwrite: replacing similar node (similarity=${bestMatch.similarity.toFixed(2)})`,
                };

            // Keep whichever has higher confidence
            case "highest_confidence":
                if (incoming.confidence > bestMatch.node.confidence) {
                    return {
                        action: "update",
                        target: bestMatch.node,
                        patch: {
                            value: incoming.value,
                            confidence: incoming.confidence,
                            updatedAt: now,
                        },
                        reason: `Policy=highest_confidence: incoming (${incoming.confidence}) > existing (${bestMatch.node.confidence})`,
                    };
                }
                return {
                    action: "skip",
                    reason: `Policy=highest_confidence: existing confidence (${bestMatch.node.confidence}) is higher — skipping`,
                    duplicate: bestMatch.node,
                };

            // Append novel information
            case "merge_append":
                return {
                    action: "update",
                    target: bestMatch.node,
                    patch: {
                        value: mergeValues(bestMatch.node.value, incoming.value),
                        confidence: Math.max(bestMatch.node.confidence, incoming.confidence),
                        updatedAt: now,
                    },
                    reason: `Policy=merge_append: appending novel tokens (similarity=${bestMatch.similarity.toFixed(2)})`,
                };

            // Immutable — never overwrite
            case "skip":
                return {
                    action: "skip",
                    reason: `Policy=skip: memory at this path is immutable`,
                    duplicate: bestMatch.node,
                };

            default: {
                // exhaustive check
                const _exhaustive: never = policy;
                return {
                    action: "skip",
                    reason: `Unknown policy: ${String(_exhaustive)}`,
                };
            }
        }
    }

    // ── 3. No similar nodes above threshold → novel memory → insert ───────────
    return { action: "insert" };
}

// ---------------------------------------------------------------------------
// Batch gate: filter a list of incoming memories
// ---------------------------------------------------------------------------

export interface GatedMemory {
    canonical: CanonicalMemory;
    decision: WriteDecision;
}

/**
 * Run the write gate over a batch of incoming canonical memories.
 *
 * Useful for processing the output of an LLM extraction prompt in one pass.
 *
 * @param incoming   List of canonical memories to evaluate
 * @param getExisting  Function that returns existing nodes for a given moryPath
 * @param options    Threshold options (same as `decideWrite`)
 */
export async function batchDecideWrite(
    incoming: CanonicalMemory[],
    getExisting: (moryPath: string) => Promise<StoredMemoryNode[]> | StoredMemoryNode[],
    options?: { similarityThreshold?: number; dedupeThreshold?: number }
): Promise<GatedMemory[]> {
    // Cache path → existing so we don't re-fetch for the same path multiple times
    const cache = new Map<string, StoredMemoryNode[]>();
    let pendingId = 0;

    const results: GatedMemory[] = [];

    for (const mem of incoming) {
        if (!cache.has(mem.path)) {
            cache.set(mem.path, await getExisting(mem.path));
        }
        const existing = cache.get(mem.path)!;
        const decision = decideWrite(existing, mem, options);

        // Keep cache in sync so later items in the same batch observe earlier
        // decisions (insert/update) deterministically.
        if (decision.action === "insert") {
            cache.set(mem.path, [
                ...existing,
                {
                    id: `batch-pending-${Date.now()}-${pendingId++}`,
                    moryPath: mem.path,
                    value: mem.value,
                    confidence: mem.confidence,
                    updatedAt: new Date().toISOString(),
                },
            ]);
        } else if (decision.action === "update") {
            const updatedNodes = existing.map((node) => {
                if (node.id !== decision.target.id) return node;
                return {
                    ...node,
                    value: decision.patch.value ?? node.value,
                    confidence: decision.patch.confidence ?? node.confidence,
                    updatedAt: decision.patch.updatedAt ?? node.updatedAt,
                };
            });
            cache.set(mem.path, updatedNodes);
        }

        results.push({ canonical: mem, decision });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Utility: explain a decision for logging
// ---------------------------------------------------------------------------

/**
 * Return a short human-readable summary of a WriteDecision.
 */
export function explainDecision(decision: WriteDecision): string {
    switch (decision.action) {
        case "insert":
            return "INSERT — novel memory, no similar existing record";
        case "update":
            return `UPDATE — ${decision.reason}`;
        case "skip":
            return `SKIP — ${decision.reason}`;
    }
}

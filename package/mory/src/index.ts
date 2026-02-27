/**
 * index.ts — package/mory barrel export
 *
 * The mory:// memory system — core modules:
 *
 *   1. morySchema   — canonical types, path registry, interfaces
 *   2. moryPath     — path normalization (prevents LLM path drift)
 *   3. moryWriteGate — novelty detection + conflict resolution before write
 *   4. moryScoring  — write scoring gate (importance/novelty/utility/confidence)
 *   5. moryConflict — deterministic conflict resolution + versioning helpers
 *   6. moryPlanner  — retrieval routing and intent planning
 *   7. moryConsolidation — episodic-to-semantic consolidation helpers
 *   8. moryWorkspace — task-scoped working-memory path helpers
 *
 * Usage:
 *
 *   import { normalizeMoryPath, decideWrite, type CanonicalMemory } from "@mory";
 *
 *   // 1. Normalize LLM-generated path
 *   const path = normalizeMoryPath("/profile/preferences/language");
 *   // → "mory://user_preference/language"
 *
 *   // 2. Gate before writing
 *   const decision = decideWrite(existingNodes, incoming);
 *   if (decision.action === "insert") { ... }
 *   if (decision.action === "update") { applyPatch(decision.target, decision.patch); }
 *   if (decision.action === "skip")   { /* discard *\/ }
 */

// ── Schema ────────────────────────────────────────────────────────────────
export {
    ALL_MEMORY_TYPES,
    MORY_PATH_REGISTRY,
    lookupRegistryEntry,
    defaultPolicyFor,
    isMoryUri,
    extractTypeFromPath,
} from "./morySchema.js";

export type {
    MemoryType,
    UpdatePolicy,
    CanonicalMemory,
    PathRegistryEntry,
} from "./morySchema.js";

// ── Path normalization ────────────────────────────────────────────────────
export {
    normalizeMoryPath,
    buildMoryPath,
    isCanonicalMoryPath,
    moryPathLabel,
    policyForRawPath,
} from "./moryPath.js";

// ── Write gate ────────────────────────────────────────────────────────────
export {
    jaccardSimilarity,
    overlapSimilarity,
    findSimilarNodes,
    decideWrite,
    batchDecideWrite,
    explainDecision,
} from "./moryWriteGate.js";

export type {
    StoredMemoryNode,
    WriteAction,
    WriteDecision,
    InsertDecision,
    UpdateDecision,
    SkipDecision,
    GatedMemory,
} from "./moryWriteGate.js";

// ── SQL templates (SQLite / pgvector) ────────────────────────────────────
export {
    SQLITE_SCHEMA_SQL,
    SQLITE_UPSERT_SQL,
    pgvectorSchemaSql,
    PGVECTOR_UPSERT_SQL,
    PGVECTOR_SEARCH_SQL,
} from "./morySql.js";

// ── Gate scoring ──────────────────────────────────────────────────────────
export {
    deriveNovelty,
    deriveImportance,
    deriveUtility,
    scoreWriteCandidate,
} from "./moryScoring.js";

export type {
    ScoreWeights,
    ScoreComponents,
    GateScoreOptions,
    GateScoreResult,
} from "./moryScoring.js";

// ── Conflict resolution ───────────────────────────────────────────────────
export {
    resolveMemoryConflict,
} from "./moryConflict.js";

export type {
    VersionedMemoryNode,
    ConflictAction,
    ConflictResolution,
    ConflictResolveOptions,
} from "./moryConflict.js";

// ── Retrieval planning ────────────────────────────────────────────────────
export {
    inferRetrievalIntent,
    buildRetrievalPlan,
} from "./moryPlanner.js";

export type {
    RetrievalIntent,
    RetrievalPlan,
    PlannerOptions,
} from "./moryPlanner.js";

// ── Consolidation ─────────────────────────────────────────────────────────
export {
    consolidateEpisodes,
    toCanonicalFromRule,
} from "./moryConsolidation.js";

export type {
    EpisodicMemory,
    ConsolidatedRule,
    ConsolidationOptions,
} from "./moryConsolidation.js";

// ── Workspace memory helpers ──────────────────────────────────────────────
export {
    buildWorkspacePath,
    isWorkspacePath,
    shouldExpireWorkingMemory,
    toWorkingMemory,
} from "./moryWorkspace.js";

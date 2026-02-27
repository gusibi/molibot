/**
 * morySchema.ts
 *
 * Canonical memory schema for the mory:// URI memory system.
 *
 * Defines:
 *  - MemoryType: the closed set of memory categories
 *  - CanonicalMemory: typed, structured memory node
 *  - MORY_PATH_REGISTRY: whitelist of known canonical paths
 *  - UpdatePolicy: how to handle conflicts on the same path
 */

// ---------------------------------------------------------------------------
// Memory Types (closed enum-like union)
// ---------------------------------------------------------------------------

/**
 * The closed set of memory categories.
 *
 * - user_preference  → how the user wants to be served (tone, length, format…)
 * - user_fact        → stable facts about the user (name, location, job…)
 * - skill            → knowledge/skill the user has or is learning
 * - event            → time-anchored incident or milestone
 * - task             → ongoing project / workspace state
 * - world_knowledge  → general knowledge not specific to the user
 */
export type MemoryType =
  | "user_preference"
  | "user_fact"
  | "skill"
  | "event"
  | "task"
  | "world_knowledge";

export const ALL_MEMORY_TYPES: MemoryType[] = [
  "user_preference",
  "user_fact",
  "skill",
  "event",
  "task",
  "world_knowledge",
];

// ---------------------------------------------------------------------------
// Update Policy
// ---------------------------------------------------------------------------

/**
 * How should an incoming memory be reconciled with an existing one at the
 * same canonical path?
 *
 * - overwrite          → newer value always wins
 * - merge_append       → append new details to existing value
 * - highest_confidence → keep the record with higher confidence score
 * - skip               → never overwrite once written (immutable facts)
 */
export type UpdatePolicy =
  | "overwrite"
  | "merge_append"
  | "highest_confidence"
  | "skip";

// ---------------------------------------------------------------------------
// Canonical Memory Node
// ---------------------------------------------------------------------------

/**
 * A fully typed, structured memory unit.
 *
 * This is the canonical form that flows through the write gate.
 * It gets persisted into the underlying MemoryRecord store with the
 * extra `moryPath`, `memoryType`, `subject`, `confidence` fields.
 */
export interface CanonicalMemory {
  /** Resolved canonical path, e.g. "mory://user_preference/answer_length" */
  path: string;

  /** Semantic category */
  type: MemoryType;

  /**
   * The specific attribute within the type.
   * For user_preference: "answer_length", "language", "tone" …
   * For user_fact:       "name", "location", "occupation" …
   * For skill:           "python.fastapi", "typescript.svelte" …
   * For event:           "2026-02-27.server_crash" …
   * For task:            "current", "project_a" …
   */
  subject: string;

  /** Human-readable summary / value, used as L1 in prompt context */
  value: string;

  /**
   * How confident we are this memory is correct (0.0 – 1.0).
   * Extracted from LLM output or defaulting to 0.7.
   */
  confidence: number;

  /**
   * Relative importance of this memory for long-term retention (0.0 – 1.0).
   * Optional because many extraction pipelines only emit confidence.
   */
  importance?: number;

  /**
   * Relative utility for downstream tasks (0.0 – 1.0).
   * Example: stable user preferences are often high-utility.
   */
  utility?: number;

  /** How conflicts at the same path should be resolved */
  updatedPolicy: UpdatePolicy;

  /** Session ID this was derived from, for traceability */
  source?: string;

  /**
   * Optional observation timestamp for conflict-resolution and lifecycle logic.
   * ISO-8601 recommended.
   */
  observedAt?: string;

  /**
   * Optional short title for L0 display in prompt context (≤ 20 chars).
   * If omitted, derived from subject.
   */
  title?: string;
}

// ---------------------------------------------------------------------------
// Path Registry: Whitelist of canonical static/prefix paths
// ---------------------------------------------------------------------------

/**
 * A registry entry describes a known canonical path segment.
 *
 * `isDynamic` means the last segment can vary (e.g. skill topic, event slug).
 * When `isDynamic` is true, `prefix` is the fixed part to match against.
 */
export interface PathRegistryEntry {
  /** Full path if static, prefix if dynamic */
  path: string;
  type: MemoryType;
  /** Subject key (for static paths) */
  subject?: string;
  /** Whether the last segment is a dynamic slug */
  isDynamic: boolean;
  defaultPolicy: UpdatePolicy;
  description: string;
}

/**
 * The canonical path whitelist.
 *
 * Static paths are matched exactly.
 * Dynamic paths are matched by prefix — the caller supplies the final segment.
 *
 * Naming convention:  mory://{type}/{subject_with_dots}
 *   dots (.) separate sub-topics within a subject, e.g. "python.fastapi"
 */
export const MORY_PATH_REGISTRY: PathRegistryEntry[] = [
  // ── user_preference ──────────────────────────────────────────────────────
  {
    path: "mory://user_preference/answer_length",
    type: "user_preference",
    subject: "answer_length",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "Preferred length of responses (short / detailed / balanced)",
  },
  {
    path: "mory://user_preference/language",
    type: "user_preference",
    subject: "language",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "Preferred language for responses",
  },
  {
    path: "mory://user_preference/tone",
    type: "user_preference",
    subject: "tone",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "Preferred tone (formal / casual / technical…)",
  },
  {
    path: "mory://user_preference/code_style",
    type: "user_preference",
    subject: "code_style",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "Code formatting preferences (tabs/spaces, naming conventions…)",
  },
  {
    path: "mory://user_preference/output_format",
    type: "user_preference",
    subject: "output_format",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "Preferred output format (markdown / plain / JSON…)",
  },

  // ── user_fact ────────────────────────────────────────────────────────────
  {
    path: "mory://user_fact/name",
    type: "user_fact",
    subject: "name",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "User's name or preferred alias",
  },
  {
    path: "mory://user_fact/location",
    type: "user_fact",
    subject: "location",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "User's current city / country",
  },
  {
    path: "mory://user_fact/occupation",
    type: "user_fact",
    subject: "occupation",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "User's job title or role",
  },
  {
    path: "mory://user_fact/timezone",
    type: "user_fact",
    subject: "timezone",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "User's timezone, e.g. Asia/Shanghai",
  },
  {
    path: "mory://user_fact/goals",
    type: "user_fact",
    subject: "goals",
    isDynamic: false,
    defaultPolicy: "merge_append",
    description: "User's stated long-term goals",
  },

  // ── skill (dynamic topic) ─────────────────────────────────────────────────
  {
    path: "mory://skill/",
    type: "skill",
    isDynamic: true,
    defaultPolicy: "merge_append",
    description: "Knowledge / skill node; topic is dynamic, e.g. 'python.fastapi'",
  },

  // ── event (dynamic: YYYY-MM-DD.slug) ─────────────────────────────────────
  {
    path: "mory://event/",
    type: "event",
    isDynamic: true,
    defaultPolicy: "merge_append",
    description: "Time-anchored event; slug is dynamic, e.g. '2026-02-27.server_crash'",
  },

  // ── task ──────────────────────────────────────────────────────────────────
  {
    path: "mory://task/current",
    type: "task",
    subject: "current",
    isDynamic: false,
    defaultPolicy: "overwrite",
    description: "The task or context being actively worked on right now",
  },
  {
    path: "mory://task/",
    type: "task",
    isDynamic: true,
    defaultPolicy: "merge_append",
    description: "Named project / workspace; slug is dynamic, e.g. 'project_a'",
  },

  // ── world_knowledge (dynamic topic) ──────────────────────────────────────
  {
    path: "mory://world_knowledge/",
    type: "world_knowledge",
    isDynamic: true,
    defaultPolicy: "highest_confidence",
    description: "General knowledge not tied to the user; topic is dynamic",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a registry entry by exact path (for static paths) or
 * by prefix (for dynamic paths).
 */
export function lookupRegistryEntry(path: string): PathRegistryEntry | undefined {
  // 1. Exact static match first
  const exact = MORY_PATH_REGISTRY.find(
    (e) => !e.isDynamic && e.path === path
  );
  if (exact) return exact;

  // 2. Prefix match for dynamic entries
  return MORY_PATH_REGISTRY.find(
    (e) => e.isDynamic && path.startsWith(e.path)
  );
}

/**
 * Return the default UpdatePolicy for a given canonical path.
 * Falls back to "merge_append" if no entry is found.
 */
export function defaultPolicyFor(path: string): UpdatePolicy {
  return lookupRegistryEntry(path)?.defaultPolicy ?? "merge_append";
}

/**
 * Check whether a string is a syntactically valid mory:// URI.
 * Does NOT check against the registry whitelist.
 */
export function isMoryUri(value: string): boolean {
  return typeof value === "string" && value.startsWith("mory://") && value.length > 7;
}

/**
 * Extract the MemoryType from a mory:// path.
 * Returns undefined if the path is malformed.
 *
 * @example
 *   extractTypeFromPath("mory://user_preference/language") // → "user_preference"
 */
export function extractTypeFromPath(path: string): MemoryType | undefined {
  if (!isMoryUri(path)) return undefined;
  const withoutScheme = path.slice("mory://".length); // "user_preference/language"
  const segment = withoutScheme.split("/")[0] as MemoryType;
  return ALL_MEMORY_TYPES.includes(segment) ? segment : undefined;
}

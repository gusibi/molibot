/**
 * moryPath.ts
 *
 * Path normalization layer for the mory:// URI memory system.
 *
 * Problem: LLMs generate inconsistent paths for the same concept:
 *   "/profile/preferences/language"
 *   "mory://user/lang_pref"
 *   "mory://profile/language"
 *
 * This module maps any raw LLM-generated path to the nearest canonical
 * mory:// URI from the MORY_PATH_REGISTRY — without requiring an embedding
 * model. Pure string + token-Jaccard similarity.
 */

import {
    type MemoryType,
    type UpdatePolicy,
    type CanonicalMemory,
    ALL_MEMORY_TYPES,
    MORY_PATH_REGISTRY,
    lookupRegistryEntry,
    isMoryUri,
    extractTypeFromPath,
    defaultPolicyFor,
} from "./morySchema.js";

// ---------------------------------------------------------------------------
// Alias Maps — common LLM hallucinations → canonical segment
// ---------------------------------------------------------------------------

/**
 * Type-level aliases: words the LLM might use for a MemoryType.
 * Keys are lowercased. Values are canonical MemoryType strings.
 */
const TYPE_ALIASES: Record<string, MemoryType> = {
    // user_preference — these are the strongest signals and should win
    preference: "user_preference",
    preferences: "user_preference",
    pref: "user_preference",
    prefs: "user_preference",
    user_pref: "user_preference",
    user_preference: "user_preference",
    setting: "user_preference",
    settings: "user_preference",
    style: "user_preference",
    // Subject-like tokens that clearly indicate a preference context
    lang_pref: "user_preference",   // e.g. mory://user/lang_pref → user_preference
    language_pref: "user_preference",
    code_style: "user_preference",
    answer_style: "user_preference",

    // user_fact — only map clear "about the user" signals
    // NOTE: "user" is kept here but in Pass-2 (alias map), so "preferences" wins Pass-1 first
    fact: "user_fact",
    facts: "user_fact",
    user: "user_fact",
    profile: "user_fact",
    info: "user_fact",
    about: "user_fact",
    personal: "user_fact",

    // skill
    skill: "skill",
    skills: "skill",
    knowledge: "skill",
    expertise: "skill",
    tech: "skill",
    technology: "skill",

    // event
    event: "event",
    events: "event",
    incident: "event",
    history: "event",
    log: "event",
    diary: "event",

    // task
    task: "task",
    tasks: "task",
    project: "task",
    workspace: "task",
    work: "task",
    current: "task",

    // world_knowledge
    world_knowledge: "world_knowledge",
    world: "world_knowledge",
    knowledge_base: "world_knowledge",
    general: "world_knowledge",
    kb: "world_knowledge",
};

/**
 * Subject-level aliases for user_preference.
 */
const PREFERENCE_SUBJECT_ALIASES: Record<string, string> = {
    lang: "language",
    lang_pref: "language",
    language_pref: "language",
    reply_length: "answer_length",
    response_length: "answer_length",
    length: "answer_length",
    answer_style: "answer_length",
    coding_style: "code_style",
    coding: "code_style",
    format: "output_format",
    output: "output_format",
    response_format: "output_format",
};

/**
 * Subject-level aliases for user_fact.
 */
const FACT_SUBJECT_ALIASES: Record<string, string> = {
    username: "name",
    nickname: "name",
    handle: "name",
    city: "location",
    country: "location",
    region: "location",
    job: "occupation",
    role: "occupation",
    position: "occupation",
    title: "occupation",
    tz: "timezone",
    time_zone: "timezone",
    goal: "goals",
    objective: "goals",
};

// ---------------------------------------------------------------------------
// Tokenization helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize a path or string into lowercase tokens.
 *
 * Splits ONLY on "/" "." and whitespace — NOT on "_" or "-", so compound
 * slugs like "project_a", "code_style", "lang_pref" survive intact and can
 * be matched against the alias maps as whole tokens.
 */
function tokenize(input: string): string[] {
    return input
        .toLowerCase()
        .replace(/^mory:\/\//, "")
        .split(/[/. \t]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== "mory");
}

/**
 * Jaccard similarity between two token sets (0.0 – 1.0).
 */
function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
    if (tokensA.length === 0 && tokensB.length === 0) return 1;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let intersection = 0;
    for (const t of setA) {
        if (setB.has(t)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Core normalization logic
// ---------------------------------------------------------------------------

/**
 * Attempt to recover the MemoryType from a raw path string.
 *
 * Two-pass priority:
 *  Pass 1: exact canonical type names across ALL segments (highest priority)
 *  Pass 2: alias map lookup (lower priority)
 *
 * This ensures "user_preference" beats "profile" for
 * "/profile/preferences/language".
 */
function inferType(segments: string[]): MemoryType | undefined {
    // Pass 1 — exact canonical names (highest priority)
    for (const seg of segments) {
        const lo = seg.toLowerCase().replace(/-/g, "_");
        if (ALL_MEMORY_TYPES.includes(lo as MemoryType)) return lo as MemoryType;
    }
    // Pass 2a — check ALL segments for user_preference aliases before any user_fact aliases.
    // This ensures compound slugs like "lang_pref" beat generic tokens like "user".
    const PREFERENCE_PRIORITY_ALIASES: Set<string> = new Set([
        "preference", "preferences", "pref", "prefs",
        "user_pref", "user_preference",
        "setting", "settings",
        "lang_pref", "language_pref", "code_style", "answer_style",
    ]);
    for (const seg of segments) {
        const lo = seg.toLowerCase();
        if (PREFERENCE_PRIORITY_ALIASES.has(lo)) return "user_preference";
    }
    // Pass 2b — remaining alias map (order: earlier segment wins)
    for (const seg of segments) {
        const lo = seg.toLowerCase();
        if (TYPE_ALIASES[lo]) return TYPE_ALIASES[lo];
        if (lo.endsWith("s") && TYPE_ALIASES[lo.slice(0, -1)]) {
            return TYPE_ALIASES[lo.slice(0, -1)];
        }
    }
    return undefined;
}

/**
 * Apply subject aliases for a given type.
 * rawSubject is already a single underscore/slug string, e.g. "lang_pref".
 */
function resolveSubjectAlias(type: MemoryType, rawSubject: string): string {
    const lo = rawSubject.toLowerCase().replace(/[\- ]+/g, "_");
    if (type === "user_preference") {
        return PREFERENCE_SUBJECT_ALIASES[lo] ?? lo;
    }
    if (type === "user_fact") {
        return FACT_SUBJECT_ALIASES[lo] ?? lo;
    }
    return lo;
}

/**
 * Given type + subject tokens, find the best matching static registry entry
 * or construct a dynamic path.
 *
 * Tokens are joined with "_" (not ".") to preserve compound slugs like
 * project_a, code_style, lang_pref when doing alias lookup.
 *
 * Dynamic paths use "." for sub-topics (python.fastapi) per registry convention.
 *
 * Returns:  "mory://type/subject"
 */
function buildBestPath(type: MemoryType, subjectSegments: string[]): string {
    if (subjectSegments.length === 0) {
        return `mory://${type}/unknown`;
    }

    // Join with underscore for alias lookup (preserves code_style, lang_pref)
    const rawSubjectUnderscore = subjectSegments.join("_");
    const resolvedSubject = resolveSubjectAlias(type, rawSubjectUnderscore);
    const candidate = `mory://${type}/${resolvedSubject}`;

    // Exact static match
    const exact = lookupRegistryEntry(candidate);
    if (exact && !exact.isDynamic) return candidate;

    // Dynamic prefix match — use "." to separate sub-topics (skill/python.fastapi)
    const dynamicEntry = MORY_PATH_REGISTRY.find(
        (e) => e.isDynamic && e.type === type
    );
    if (dynamicEntry) {
        // For dynamic paths, use dots if there are multiple segments
        const dynamicSubject = subjectSegments.length > 1
            ? subjectSegments.join(".")
            : resolvedSubject;
        return `${dynamicEntry.path}${dynamicSubject}`;
    }

    return candidate;
}


/**
 * Find the registry entry whose static path is most similar to `rawPath`
 * using token Jaccard similarity. Used as last-resort fallback.
 */
function bestRegistryMatch(rawTokens: string[]): PathRegistryEntry | undefined {
    let best: { entry: PathRegistryEntry; score: number } | undefined;

    for (const entry of MORY_PATH_REGISTRY) {
        const entryTokens = tokenize(entry.path);
        const score = jaccardSimilarity(rawTokens, entryTokens);
        if (!best || score > best.score) {
            best = { entry, score };
        }
    }

    // Only accept if similarity is reasonable
    return best && best.score >= 0.2 ? best.entry : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Import the type so we can reference it in JSDoc
type PathRegistryEntry = (typeof MORY_PATH_REGISTRY)[number];

/**
 * Normalize any LLM-generated raw path to the nearest canonical mory:// URI.
 *
 * Strategy (in order):
 *  1. Already a valid mory:// URI that exists in the registry → return as-is
 *  2. Strip scheme variants and resolve type from segments + alias map
 *  3. Resolve subject aliases
 *  4. Build best matching canonical path
 *  5. Token Jaccard fallback against full registry
 *  6. Last resort: mory://event/{today}/{slug}
 *
 * @example
 *   normalizeMoryPath("/profile/preferences/language")
 *   // → "mory://user_preference/language"
 *
 *   normalizeMoryPath("mory://user/lang_pref")
 *   // → "mory://user_preference/language"
 *
 *   normalizeMoryPath("mory://skill/python/fastapi")
 *   // → "mory://skill/python.fastapi"
 */
export function normalizeMoryPath(rawPath: string): string {
    if (!rawPath || typeof rawPath !== "string") {
        return fallbackPath();
    }

    const trimmed = rawPath.trim();

    // 1. Valid mory:// URI that's in the registry → keep
    if (isMoryUri(trimmed)) {
        const entry = lookupRegistryEntry(trimmed);
        if (entry) {
            // Already canonical — but still normalize dynamic segments
            if (!entry.isDynamic) return trimmed;
            // Dynamic entry: the path starts with the prefix, rest is subject slug
            return normalizeDynamicSegment(entry, trimmed);
        }

        // mory:// URI but NOT in registry → try to repair via type extraction
        const knownType = extractTypeFromPath(trimmed);
        if (knownType) {
            const withoutSchemeAndType = trimmed.slice(`mory://${knownType}/`.length);
            const subjectSegments = tokenize(withoutSchemeAndType);
            return buildBestPath(knownType, subjectSegments);
        }
    }

    // 2. Strip various scheme/prefix noise and tokenize
    const strippedTokens = tokenize(trimmed);

    // 3. Infer type from tokens + extract subject remainder
    const inferredType = inferType(strippedTokens);
    if (inferredType) {
        // Find the index of the segment that triggered the type match.
        // We only remove THAT segment; remaining segments become the subject.
        const typeTokensCanonical = new Set([inferredType, ...tokenize(inferredType)]);
        const PREFERENCE_PRIORITY_ALIASES_SET = new Set([
            "preference", "preferences", "pref", "prefs",
            "user_pref", "user_preference",
            "setting", "settings",
            "lang_pref", "language_pref", "code_style", "answer_style",
        ]);

        // Find first segment that caused the type match
        let typeSegmentIndex = -1;
        for (let i = 0; i < strippedTokens.length; i++) {
            const lo = strippedTokens[i].toLowerCase().replace(/-/g, "_");
            const isExact = ALL_MEMORY_TYPES.includes(lo as MemoryType);
            const isPrefPriority = PREFERENCE_PRIORITY_ALIASES_SET.has(lo);
            const isAlias = !!TYPE_ALIASES[lo];
            if (isExact || isPrefPriority || isAlias) {
                typeSegmentIndex = i;
                break;
            }
        }

        // Build subject: all segments except the type-matched one, preserve order
        // Also filter generic category noise tokens that carry no subject info
        const NOISE_SUBJECT_TOKENS = new Set([
            "profile", "user", "info", "about", "personal",
            "preference", "preferences", "pref", "prefs",
            "setting", "settings",
            "fact", "facts",
        ]);
        const subjectTokens = strippedTokens.filter(
            (t, i) => i !== typeSegmentIndex && !NOISE_SUBJECT_TOKENS.has(t)
        );

        // Special case: if the matched token IS a subject alias (e.g. lang_pref),
        // keep the OTHER tokens and treat the matched token itself as the subject hint
        const matchedToken = typeSegmentIndex >= 0 ? strippedTokens[typeSegmentIndex] : "";
        if (subjectTokens.length === 0 && matchedToken) {
            // The type trigger token is also a subject hint (e.g. "lang_pref" → "language")
            return buildBestPath(inferredType, [matchedToken]);
        }

        return buildBestPath(inferredType, subjectTokens);
    }

    // 4. Token Jaccard fallback against full registry
    const match = bestRegistryMatch(strippedTokens);
    if (match) {
        if (!match.isDynamic) return match.path;
        // Dynamic: use the match prefix + an inferred slug
        const prefixTokens = tokenize(match.path);
        const slug = strippedTokens
            .filter((t) => !prefixTokens.includes(t))
            .join(".");
        return slug ? `${match.path}${slug}` : match.path + "unknown";
    }

    // 5. Absolute last resort
    return fallbackPath(trimmed);
}

/**
 * Normalize the dynamic segment of a dynamic registry path.
 * E.g. "mory://skill/Python / FastAPI" → "mory://skill/python.fastapi"
 */
function normalizeDynamicSegment(
    entry: PathRegistryEntry,
    fullPath: string
): string {
    const slug = fullPath.slice(entry.path.length);
    const normalizedSlug = slug
        .toLowerCase()
        .replace(/[/\s\-]+/g, ".")   // slash/space/dash → dot
        .replace(/[^a-z0-9_.]/g, "") // strip non-safe chars
        .replace(/\.{2,}/g, ".")     // collapse repeated dots
        .replace(/^\.+|\.+$/g, "");  // trim leading/trailing dots

    return normalizedSlug
        ? `${entry.path}${normalizedSlug}`
        : `${entry.path}unknown`;
}

/** Generate a dated fallback path for unmappable memories */
function fallbackPath(hint?: string): string {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const slug = hint
        ? tokenize(hint).slice(0, 3).join("_") || "unknown"
        : "unknown";
    return `mory://event/${today}.${slug}`;
}

// ---------------------------------------------------------------------------
// Build path from CanonicalMemory fields
// ---------------------------------------------------------------------------

/**
 * Build a canonical mory:// path from a CanonicalMemory's type + subject.
 * Normalizes the subject so it matches the registry conventions.
 *
 * @example
 *   buildMoryPath({ type: "user_preference", subject: "answer_length" })
 *   // → "mory://user_preference/answer_length"
 *
 *   buildMoryPath({ type: "skill", subject: "python/fastapi" })
 *   // → "mory://skill/python.fastapi"
 */
export function buildMoryPath(
    memory: Pick<CanonicalMemory, "type" | "subject">
): string {
    const subject = memory.subject
        .toLowerCase()
        .replace(/[/\s\-]+/g, ".")
        .replace(/[^a-z0-9_.]/g, "")
        .replace(/\.{2,}/g, ".")
        .replace(/^\.+|\.+$/g, "");

    const candidate = `mory://${memory.type}/${subject}`;

    // Check if it's in the registry
    const entry = lookupRegistryEntry(candidate);
    if (entry) {
        if (!entry.isDynamic) return candidate;
        return normalizeDynamicSegment(entry, candidate);
    }

    // Not in registry but type is valid → use as-is (future extension)
    return candidate;
}

/**
 * Check whether a string is a valid, registry-recognized mory:// URI.
 * (Stricter than `isMoryUri` which only checks syntax.)
 */
export function isCanonicalMoryPath(path: string): boolean {
    if (!isMoryUri(path)) return false;
    const entry = lookupRegistryEntry(path);
    if (!entry) return false;
    if (entry.isDynamic) {
        return path.length > entry.path.length;
    }
    return true;
}

/**
 * Reconstruct a display-friendly label from a mory:// path.
 *
 * @example
 *   moryPathLabel("mory://user_preference/answer_length") // → "user_preference / answer_length"
 */
export function moryPathLabel(path: string): string {
    if (!isMoryUri(path)) return path;
    return path.slice("mory://".length).replace(/\//g, " / ");
}

/**
 * Derive the UpdatePolicy for a raw path (after normalizing it).
 */
export function policyForRawPath(rawPath: string): UpdatePolicy {
    const canonical = normalizeMoryPath(rawPath);
    return defaultPolicyFor(canonical);
}

/**
 * moryIntegration.ts
 *
 * Integration adapter: shows exactly how to connect the mory:// three-module
 * system into the existing `src/lib/server/memory/` stack.
 *
 * IMPORTANT: This file is a REFERENCE IMPLEMENTATION / RECIPE.
 * It is NOT meant to be imported directly — copy the relevant logic into
 * `jsonFileCore.ts` and `gateway.ts` when you're ready to wire it up.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Integration points:
 *
 *   A. MemoryRecord (types.ts) — add optional mory fields
 *   B. JsonFileMemoryCore.add() — call write gate before push
 *   C. MemoryGateway.buildPromptContext() — L0/L1 grouped output
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
    normalizeMoryPath,
    decideWrite,
    explainDecision,
    moryPathLabel,
    type CanonicalMemory,
    type StoredMemoryNode,
    type WriteDecision,
    defaultPolicyFor,
    extractTypeFromPath,
} from "./index.js";

// ============================================================================
// A. Extended MemoryRecord fields (paste into types.ts)
// ============================================================================

/**
 * Add these optional fields to the existing `MemoryRecord` interface in types.ts.
 * All fields are optional → fully backward compatible with existing JSON data.
 *
 * ```typescript
 * // Inside MemoryRecord:
 * moryPath?: string;              // canonical "mory://type/subject"
 * memoryType?: MemoryType;        // "user_preference" | "user_fact" | ...
 * subject?: string;               // normalized subject segment
 * confidence?: number;            // 0.0 – 1.0
 * embeddingModelVersion?: string; // e.g. "text-embedding-3-small.v1" — for future rebuild
 * ```
 *
 * Also add to MemoryAddInput:
 * ```typescript
 * moryPath?: string;       // caller-provided path (will be normalized)
 * memoryType?: MemoryType;
 * subject?: string;
 * confidence?: number;
 * ```
 */

// ============================================================================
// B. JsonFileMemoryCore.add() — write gate integration
// ============================================================================

/**
 * Drop-in replacement for the relevant section of JsonFileMemoryCore.add().
 *
 * Replace the existing exact-match dedup block with this logic when
 * the input includes a `moryPath`.
 *
 * @example
 * ```typescript
 * // In jsonFileCore.ts, inside async add():
 *
 * const content = normalizeContent(input.content);
 *
 * // — NEW: mory-aware write gate —
 * if (input.moryPath) {
 *   const result = await moryAwareAdd(data.items, scope, input, content, now);
 *   if (result.record) {
 *     this.reconcileConflicts(data);
 *     this.saveData(data);
 *     return result.record;
 *   }
 *   // result.shouldInsert === true → fall through to existing insert logic
 * }
 *
 * // — existing exact-match dedup (keep for plain records without moryPath) —
 * const existing = data.items.find((item) => …)
 * ```
 */
export async function moryAwareAdd(
    allItems: Array<{
        id: string;
        channel: string;
        externalUserId: string;
        content: string;
        moryPath?: string;
        confidence?: number;
        updatedAt: string;
    }>,
    scope: { channel: string; externalUserId: string },
    input: {
        content: string;
        moryPath?: string;
        memoryType?: string;
        subject?: string;
        confidence?: number;
        updatedPolicy?: string;
    },
    normalizedContent: string,
    now: string
): Promise<{
    shouldInsert: boolean;
    record?: (typeof allItems)[number];
    decision: WriteDecision;
}> {
    if (!input.moryPath) {
        return { shouldInsert: true, decision: { action: "insert" } };
    }

    // 1. Normalize path
    const canonicalPath = normalizeMoryPath(input.moryPath);

    // 2. Build canonical memory object
    const inferredType = extractTypeFromPath(canonicalPath) ?? "world_knowledge";
    const inferredPolicy = defaultPolicyFor(canonicalPath);
    const incoming: CanonicalMemory = {
        path: canonicalPath,
        type: inferredType,
        subject: input.subject ?? canonicalPath.split("/").pop() ?? "unknown",
        value: normalizedContent,
        confidence: input.confidence ?? 0.7,
        updatedPolicy: (input.updatedPolicy ?? inferredPolicy) as CanonicalMemory["updatedPolicy"],
    };

    // 3. Find existing nodes at same path + scope
    const existingNodes: StoredMemoryNode[] = allItems
        .filter(
            (item) =>
                item.channel === scope.channel &&
                item.externalUserId === scope.externalUserId &&
                item.moryPath === canonicalPath
        )
        .map((item) => ({
            id: item.id,
            moryPath: item.moryPath!,
            value: item.content,
            confidence: item.confidence ?? 0.5,
            updatedAt: item.updatedAt,
        }));

    // 4. Run write gate
    const decision = decideWrite(existingNodes, incoming);

    if (decision.action === "skip") {
        // Return the existing duplicate record
        const dup = allItems.find(
            (item) =>
                item.channel === scope.channel &&
                item.externalUserId === scope.externalUserId &&
                item.moryPath === canonicalPath &&
                item.id === decision.duplicate?.id
        );
        return { shouldInsert: false, record: dup, decision };
    }

    if (decision.action === "update") {
        // Find target item and apply patch
        const target = allItems.find(
            (item) =>
                item.channel === scope.channel &&
                item.externalUserId === scope.externalUserId &&
                item.id === decision.target.id
        );
        if (target) {
            if (decision.patch.value !== undefined) target.content = decision.patch.value;
            if (decision.patch.updatedAt !== undefined) target.updatedAt = decision.patch.updatedAt;
            // confidence update — requires the field to exist
            const t = target as typeof target & { confidence?: number };
            if (decision.patch.confidence !== undefined) t.confidence = decision.patch.confidence;
        }
        return { shouldInsert: false, record: target, decision };
    }

    // action === "insert" — update moryPath before inserting
    // The caller should set moryPath = canonicalPath on the new record
    return { shouldInsert: true, decision };
}

// ============================================================================
// C. MemoryGateway.buildPromptContext() — L0/L1 mory-aware output
// ============================================================================

/**
 * Replace `buildPromptContext` in gateway.ts with this version.
 *
 * Groups memories by moryPath and renders them in L0/L1 style:
 *
 * ```
 * [Memory Index]
 * mory://user_preference/answer_length — 用户偏好简短回答
 * mory://user_fact/name — 用户名字：Gusi
 * mory://skill/python.fastapi — 正在学习 FastAPI，完成基础教程
 *
 * 如需详情，请调用工具 read_memory(path)。
 * ```
 *
 * Falls back to the original flat format for records without moryPath.
 */
export function buildMoryPromptContext(
    rows: Array<{
        content: string;
        moryPath?: string;
        layer?: string;
    }>,
    opts: { includeFallback?: boolean } = {}
): string {
    if (rows.length === 0) return "";

    const moryRows = rows.filter((r) => r.moryPath);
    const plainRows = rows.filter((r) => !r.moryPath);

    const sections: string[] = [];

    // — Mory-path grouped section —
    if (moryRows.length > 0) {
        const lines = moryRows.map((r) => {
            const label = moryPathLabel(r.moryPath!); // "user_preference / answer_length"
            return `${label} (${r.moryPath}) — ${r.content}`;
        });
        sections.push("[Memory Index]\n" + lines.join("\n"));
        sections.push("如需详情，请调用工具 read_memory(path)。");
    }

    // — Legacy plain rows —
    if (plainRows.length > 0 && opts.includeFallback) {
        const longTerm = plainRows.filter((r) => r.layer === "long_term");
        const daily = plainRows.filter((r) => r.layer === "daily");
        if (longTerm.length > 0) {
            sections.push(
                "Long-term memory:\n" +
                longTerm.map((r, i) => `${i + 1}. ${r.content}`).join("\n")
            );
        }
        if (daily.length > 0) {
            sections.push(
                "Recent daily memory:\n" +
                daily.map((r, i) => `${i + 1}. ${r.content}`).join("\n")
            );
        }
    }

    return sections.join("\n\n");
}

// ============================================================================
// D. LLM extraction prompt template
// ============================================================================

/**
 * Prompt template to inject into the async commit/flush call.
 *
 * Feed this to the LLM after each conversation turn to extract
 * canonical memories with mory:// paths.
 *
 * The TYPE_HINT lists help the LLM pick the right type and subject,
 * keeping粒度 stable.
 */
export const MEMORY_EXTRACTION_PROMPT = `
你是一个记忆提取助手。分析以下对话，提取值得长期记忆的信息。

规则：
1. 只提取明确、稳定、有价值的信息，不提取临时性内容
2. 每条记忆必须选择下列 type 之一：
   - user_preference: 用户偏好（回答长度/语言/风格/代码风格…）
   - user_fact: 用户事实（姓名/职业/位置/时区…）
   - skill: 技能/知识（编程语言/框架/工具…）
   - event: 时间事件（项目/事故/里程碑…）
   - task: 当前任务/项目状态
   - world_knowledge: 通用知识（非用户专属）
3. subject 使用英文小写，用点号 (.) 分隔子主题，例如 "python.fastapi"
4. confidence 为 0.0-1.0，不确定时填 0.6
5. 如无值得记忆的内容，返回 {"memories": []}

输出格式（严格 JSON）：
{
  "memories": [
    {
      "type": "user_preference",
      "subject": "answer_length",
      "value": "用户明确表示更喜欢简短的回答风格",
      "confidence": 0.9,
      "updatedPolicy": "overwrite",
      "title": "偏好简短回答"
    }
  ]
}

对话内容：
{dialogue}
`.trim();

// ============================================================================
// E. Quick smoke-test helper (for development / Node REPL)
// ============================================================================

/**
 * Run a quick in-process smoke test of all three modules.
 * Call from Node REPL or a one-off script:
 *
 *   import { runSmokeTest } from "package/mory/moryIntegration.js";
 *   runSmokeTest();
 */
export function runSmokeTest(): void {
    console.log("=== mory smoke test ===\n");

    // ── Path normalization ──
    const pathCases = [
        ["/profile/preferences/language", "mory://user_preference/language"],
        ["mory://user/lang_pref", "mory://user_preference/language"],
        ["mory://skill/python/fastapi", "mory://skill/python.fastapi"],
        ["mory://profile/name", "mory://user_fact/name"],
        ["/workspace/project_a", "mory://task/project_a"],
    ] as const;

    console.log("Path normalization:");
    for (const [input, expected] of pathCases) {
        const result = normalizeMoryPath(input);
        const ok = result === expected ? "✅" : "❌";
        console.log(`  ${ok} normalizeMoryPath("${input}")`);
        if (result !== expected) {
            console.log(`       expected: ${expected}`);
            console.log(`       got:      ${result}`);
        }
    }

    // ── Write gate ──
    console.log("\nWrite gate:");

    const existing: StoredMemoryNode[] = [];

    // First write → insert
    const incoming1: CanonicalMemory = {
        path: "mory://user_preference/answer_length",
        type: "user_preference",
        subject: "answer_length",
        value: "用户偏好简短回答",
        confidence: 0.9,
        updatedPolicy: "overwrite",
    };
    const d1 = decideWrite(existing, incoming1);
    console.log(`  ${d1.action === "insert" ? "✅" : "❌"} First write → ${d1.action} (expected insert)`);

    // Second write same content → skip
    const existingNode: StoredMemoryNode = {
        id: "abc",
        moryPath: incoming1.path,
        value: incoming1.value,
        confidence: incoming1.confidence,
        updatedAt: new Date().toISOString(),
    };
    const d2 = decideWrite([existingNode], incoming1);
    console.log(`  ${d2.action === "skip" ? "✅" : "❌"} Duplicate write → ${d2.action} (expected skip)`);

    // Different value, overwrite policy → update
    const incoming2: CanonicalMemory = {
        ...incoming1,
        value: "用户现在偏好详细的回答",
        confidence: 0.95,
    };
    const d3 = decideWrite([existingNode], incoming2);
    console.log(`  ${d3.action === "update" ? "✅" : "❌"} New value (overwrite) → ${d3.action} (expected update)`);

    console.log("\n=== smoke test complete ===");
}

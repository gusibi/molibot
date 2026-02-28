/**
 * moryRetrieval.ts
 *
 * Retrieval executor: planner + recall + rerank + L0/L1/L2 prompt injection.
 */

import type { PersistedMemoryNode, StorageAdapter } from "./moryAdapter.js";
import { buildRetrievalPlan, type PlannerOptions, type RetrievalPlan } from "./moryPlanner.js";
import { jaccardSimilarity, overlapSimilarity } from "./moryWriteGate.js";

export interface RetrieveOptions {
  planner?: PlannerOptions;
  topK?: number;
  l0Limit?: number;
  l1Limit?: number;
  l2Limit?: number;
}

export interface RerankedNode {
  node: PersistedMemoryNode;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  recencyScore: number;
}

export interface RetrievalResult {
  plan: RetrievalPlan;
  hits: RerankedNode[];
  l0: Array<{ path: string; title: string }>;
  l1: Array<{ path: string; summary: string }>;
  l2: Array<{ path: string; detail: string }>;
  promptContext: string;
}

export interface RetrievalExecutorDeps {
  storage: StorageAdapter;
  embedder?: (text: string) => Promise<number[]>;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function lexicalScore(query: string, text: string): number {
  return Math.max(jaccardSimilarity(query, text), overlapSimilarity(query, text));
}

function recencyScore(updatedAt: string): number {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms) || ms <= 0) return 0.3;
  const ageDays = Math.max(0, (Date.now() - ms) / 86400000);
  return Math.exp(-ageDays / 14);
}

function titleFor(node: PersistedMemoryNode): string {
  if (node.title) return node.title;
  const subject = node.subject || node.path.split("/").pop() || "unknown";
  return `${subject}: ${node.value.slice(0, 22)}`;
}

function formatPromptContext(result: RetrievalResult): string {
  const lines: string[] = [];

  if (result.l0.length > 0) {
    lines.push("[L0 Memory Index]");
    for (const item of result.l0) {
      lines.push(`- ${item.path} — ${item.title}`);
    }
  }

  if (result.l1.length > 0) {
    lines.push("\n[L1 Summary]");
    for (const item of result.l1) {
      lines.push(`- ${item.path}: ${item.summary}`);
    }
  }

  if (result.l2.length > 0) {
    lines.push("\n[L2 Detail]");
    for (const item of result.l2) {
      lines.push(`- ${item.path}: ${item.detail}`);
    }
  }

  return lines.join("\n").trim();
}

export async function executeRetrieval(
  deps: RetrievalExecutorDeps,
  userId: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievalResult> {
  const plan = buildRetrievalPlan(query, options.planner);
  const topK = options.topK ?? plan.topK;

  let semanticHits: Array<{ node: PersistedMemoryNode; similarity: number }> = [];
  if (deps.embedder) {
    const queryVec = await deps.embedder(query);
    semanticHits = await deps.storage.vectorSearch(userId, {
      vector: queryVec,
      topK: Math.max(topK * 2, topK),
      memoryTypes: plan.memoryTypes,
      pathPrefixes: plan.pathPrefixes,
    });
  }

  const pool = await deps.storage.list(userId, {
    includeArchived: false,
    memoryTypes: plan.memoryTypes,
    pathPrefixes: plan.pathPrefixes,
    limit: Math.max(topK * 6, 60),
  });

  const semanticById = new Map<string, number>();
  for (const hit of semanticHits) semanticById.set(hit.node.id, clamp01(hit.similarity));

  const reranked = pool
    .map((node): RerankedNode => {
      const semanticScore = semanticById.get(node.id) ?? 0;
      const lexical = lexicalScore(query, `${node.title ?? ""} ${node.value}`);
      const recency = recencyScore(node.updatedAt);
      const score = clamp01(
        semanticScore * 0.55 +
        lexical * 0.2 +
        clamp01(node.confidence) * 0.1 +
        clamp01(node.importance) * 0.1 +
        recency * 0.05
      );
      return {
        node,
        score,
        semanticScore,
        lexicalScore: lexical,
        recencyScore: recency,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const l0Limit = options.l0Limit ?? Math.min(3, reranked.length);
  const l1Limit = options.l1Limit ?? Math.min(6, reranked.length);
  const l2Limit = options.l2Limit ?? Math.min(2, reranked.length);

  const l0 = reranked.slice(0, l0Limit).map((item) => ({
    path: item.node.path,
    title: titleFor(item.node),
  }));

  const l1 = reranked.slice(0, l1Limit).map((item) => ({
    path: item.node.path,
    summary: item.node.value,
  }));

  const l2 = reranked
    .filter((item) => !!item.node.detail)
    .slice(0, l2Limit)
    .map((item) => ({
      path: item.node.path,
      detail: item.node.detail ?? "",
    }));

  const result: RetrievalResult = {
    plan,
    hits: reranked,
    l0,
    l1,
    l2,
    promptContext: "",
  };

  result.promptContext = formatPromptContext(result);
  return result;
}

export function readMemoryByPathResult(node: PersistedMemoryNode): string {
  const lines = [
    `path: ${node.path}`,
    `type: ${node.memoryType}`,
    `subject: ${node.subject}`,
    `value: ${node.value}`,
    `confidence: ${node.confidence.toFixed(2)}`,
    `importance: ${node.importance.toFixed(2)}`,
    `version: ${node.version}`,
  ];
  if (node.detail) lines.push(`detail: ${node.detail}`);
  if (node.supersedes) lines.push(`supersedes: ${node.supersedes}`);
  if (node.conflictFlag) lines.push("conflict_flag: true");
  return lines.join("\n");
}

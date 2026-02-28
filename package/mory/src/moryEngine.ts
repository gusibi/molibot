/**
 * moryEngine.ts
 *
 * Unified orchestration layer:
 * - ingest
 * - retrieve
 * - commit (async pipeline)
 * - readByPath / read_memory API
 */

import { decideWrite, type StoredMemoryNode } from "./moryWriteGate.js";
import { resolveMemoryConflict } from "./moryConflict.js";
import { normalizeMoryPath } from "./moryPath.js";
import { defaultPolicyFor, extractTypeFromPath, type CanonicalMemory } from "./morySchema.js";
import { scoreWriteCandidate } from "./moryScoring.js";
import type { PersistedMemoryNode, StorageAdapter } from "./moryAdapter.js";
import { executeRetrieval, readMemoryByPathResult, type RetrievalResult, type RetrieveOptions } from "./moryRetrieval.js";
import { MoryMetrics, type MoryMetricsSnapshot } from "./moryMetrics.js";
import { validateCanonicalMemory, validateExtractionPayload, type ValidationIssue } from "./moryValidation.js";

export interface CommitInput {
  userId: string;
  dialogue?: string;
  extracted?: unknown;
  source?: string;
  observedAt?: string;
}

export interface IngestInput {
  userId: string;
  memory: CanonicalMemory | unknown;
  source?: string;
  observedAt?: string;
}

export interface CommitItemResult {
  action: "insert" | "update" | "skip";
  path: string;
  id?: string;
  reason: string;
  issues?: ValidationIssue[];
}

export interface CommitResult {
  accepted: number;
  skipped: number;
  errors: number;
  items: CommitItemResult[];
  issues: ValidationIssue[];
}

export interface MoryEngineOptions {
  storage: StorageAdapter;
  extractor?: (dialogue: string) => Promise<unknown>;
  embedder?: (text: string) => Promise<number[]>;
  metrics?: MoryMetrics;
  now?: () => string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mkId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toStored(nodes: PersistedMemoryNode[]): StoredMemoryNode[] {
  return nodes
    .filter((n) => !n.archivedAt)
    .map((n) => ({
      id: n.id,
      moryPath: n.path,
      value: n.value,
      confidence: n.confidence,
      updatedAt: n.updatedAt,
    }));
}

function toVersioned(node: PersistedMemoryNode) {
  return {
    id: node.id,
    moryPath: node.path,
    value: node.value,
    confidence: node.confidence,
    updatedAt: node.updatedAt,
    observedAt: node.updatedAt,
    version: node.version,
    subject: node.subject,
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class MoryEngine {
  readonly metrics: MoryMetrics;

  constructor(private readonly options: MoryEngineOptions) {
    this.metrics = options.metrics ?? new MoryMetrics();
  }

  async init(): Promise<void> {
    await this.options.storage.init();
  }

  private now(): string {
    return this.options.now ? this.options.now() : nowIso();
  }

  async ingest(input: IngestInput): Promise<CommitItemResult> {
    const validation = validateCanonicalMemory(input.memory, {
      source: input.source,
      observedAt: input.observedAt,
    });
    if (!validation.ok || !validation.memory) {
      return {
        action: "skip",
        path: "",
        reason: "Validation failed",
        issues: validation.issues,
      };
    }

    const memory = validation.memory;
    const existing = await this.options.storage.readByPath(input.userId, memory.path, false);

    const score = scoreWriteCandidate(toStored(existing), memory);
    if (!score.shouldWrite) {
      this.metrics.recordWrite("skip", true);
      return {
        action: "skip",
        path: memory.path,
        reason: score.reason,
      };
    }

    const gateDecision = decideWrite(toStored(existing), memory);
    if (gateDecision.action === "skip") {
      this.metrics.recordWrite("skip", !!gateDecision.duplicate);
      return {
        action: "skip",
        path: memory.path,
        id: gateDecision.duplicate?.id,
        reason: gateDecision.reason,
      };
    }

    if (gateDecision.action === "insert" || existing.length === 0) {
      // Determine the next version safely, accounting for any archived nodes
      // that may already occupy version=1 at this path.
      const allAtPath = await this.options.storage.readByPath(input.userId, memory.path, true);
      const nextVersion = allAtPath.length > 0
        ? Math.max(...allAtPath.map((n) => n.version)) + 1
        : 1;
      const created = await this.insertSnapshot(input.userId, memory, {
        version: nextVersion,
        supersedes: undefined,
        conflictFlag: false,
      });
      this.metrics.recordWrite("insert");
      return {
        action: "insert",
        path: memory.path,
        id: created.id,
        reason: "Inserted new memory",
      };
    }

    const target = existing.find((n) => n.id === gateDecision.target.id) ?? existing[0];
    const resolution = resolveMemoryConflict(toVersioned(target), memory);

    if (resolution.conflict) this.metrics.recordConflict(1);

    if (resolution.action === "keep_existing") {
      this.metrics.recordWrite("skip");
      return {
        action: "skip",
        path: memory.path,
        id: target.id,
        reason: resolution.reason,
      };
    }

    if (resolution.action === "flag_conflict") {
      await this.options.storage.update(input.userId, target.id, {
        conflictFlag: true,
        updatedAt: this.now(),
      });
      this.metrics.recordWrite("skip");
      return {
        action: "skip",
        path: memory.path,
        id: target.id,
        reason: resolution.reason,
      };
    }

    await this.options.storage.archive(input.userId, [target.id]);
    const created = await this.insertSnapshot(input.userId, memory, {
      version: target.version + 1,
      supersedes: target.id,
      conflictFlag: !!resolution.conflict,
      valueOverride: resolution.next?.value,
      confidenceOverride: resolution.next?.confidence,
    });
    this.metrics.recordWrite("update");
    return {
      action: "update",
      path: memory.path,
      id: created.id,
      reason: resolution.reason,
    };
  }

  private async insertSnapshot(
    userId: string,
    memory: CanonicalMemory,
    opts: {
      version: number;
      supersedes?: string;
      conflictFlag: boolean;
      valueOverride?: string;
      confidenceOverride?: number;
    }
  ): Promise<PersistedMemoryNode> {
    const now = this.now();
    const value = opts.valueOverride ?? memory.value;
    const confidence = opts.confidenceOverride ?? memory.confidence;
    const path = normalizeMoryPath(memory.path);
    const memoryType = extractTypeFromPath(path) ?? memory.type;

    let embedding: number[] | undefined;
    if (this.options.embedder) {
      embedding = await this.options.embedder(value);
    }

    const node: PersistedMemoryNode = {
      id: mkId(),
      userId,
      path,
      memoryType,
      subject: memory.subject || path.split("/").pop() || "unknown",
      title: memory.title,
      value,
      detail: undefined,
      confidence,
      importance: memory.importance ?? 0.6,
      utility: memory.utility,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: undefined,
      embedding,
      version: opts.version,
      supersedes: opts.supersedes,
      conflictFlag: opts.conflictFlag,
      archivedAt: undefined,
    };

    return this.options.storage.insert(node);
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const issues: ValidationIssue[] = [];

    let payload = input.extracted;
    if (!payload) {
      if (!this.options.extractor || !input.dialogue) {
        return {
          accepted: 0,
          skipped: 0,
          errors: 1,
          items: [],
          issues: [{ field: "commit", message: "missing extracted payload or extractor+dialogue" }],
        };
      }
      payload = await this.options.extractor(input.dialogue);
    }

    const validated = validateExtractionPayload(payload, {
      source: input.source,
      observedAt: input.observedAt,
    });
    issues.push(...validated.issues);

    if (input.dialogue) {
      this.metrics.recordTokenCost(estimateTokens(input.dialogue));
    }

    const items: CommitItemResult[] = [];

    for (const memory of validated.memories) {
      const result = await this.ingest({
        userId: input.userId,
        memory,
        source: input.source,
        observedAt: input.observedAt,
      });
      items.push(result);
    }

    const accepted = items.filter((i) => i.action !== "skip").length;
    const skipped = items.filter((i) => i.action === "skip").length;

    return {
      accepted,
      skipped,
      errors: issues.length,
      items,
      issues,
    };
  }

  async retrieve(userId: string, query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
    const result = await executeRetrieval(
      {
        storage: this.options.storage,
        embedder: this.options.embedder,
      },
      userId,
      query,
      options
    );
    this.metrics.recordRetrieval(result.hits.length);
    return result;
  }

  async readByPath(userId: string, rawPath: string): Promise<PersistedMemoryNode[]> {
    const canonicalPath = normalizeMoryPath(rawPath);
    const rows = await this.options.storage.readByPath(userId, canonicalPath, false);
    if (rows.length > 0) {
      const now = this.now();
      await Promise.all(
        rows.map((row) =>
          this.options.storage.update(userId, row.id, {
            accessCount: row.accessCount + 1,
            lastAccessedAt: now,
            updatedAt: row.updatedAt,
          })
        )
      );
    }
    return rows;
  }

  async readMemory(userId: string, rawPath: string): Promise<{ path: string; records: string[] }> {
    const path = normalizeMoryPath(rawPath);
    const rows = await this.readByPath(userId, path);
    return {
      path,
      records: rows.map((row) => readMemoryByPathResult(row)),
    };
  }

  getMetrics(): MoryMetricsSnapshot {
    return this.metrics.snapshot();
  }
}

export function createReadMemoryTool(engine: MoryEngine, userId: string) {
  return async function read_memory(path: string): Promise<{ path: string; records: string[] }> {
    return engine.readMemory(userId, path);
  };
}

export function canonicalizeForIngest(memory: Partial<CanonicalMemory>): CanonicalMemory {
  const path = normalizeMoryPath(memory.path ?? `mory://world_knowledge/${memory.subject ?? "unknown"}`);
  return {
    path,
    type: memory.type ?? extractTypeFromPath(path) ?? "world_knowledge",
    subject: memory.subject ?? path.split("/").pop() ?? "unknown",
    value: memory.value ?? "",
    confidence: memory.confidence ?? 0.7,
    updatedPolicy: memory.updatedPolicy ?? defaultPolicyFor(path),
    importance: memory.importance,
    utility: memory.utility,
    source: memory.source,
    observedAt: memory.observedAt,
    title: memory.title,
  };
}

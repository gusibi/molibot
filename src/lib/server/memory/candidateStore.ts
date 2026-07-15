import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { normalizeForMatch } from "#mory";
import type {
  MemoryCandidate,
  MemoryCandidateCreateInput,
  MemoryCandidateStatus
} from "$lib/server/memory/types.js";

type CandidateRow = {
  id: string;
  fingerprint: string;
  run_key: string | null;
  payload_json: string;
  status: MemoryCandidateStatus | "confirming";
  confirmed_memory_id: string | null;
  created_at: string;
  updated_at: string;
};

function parseRow(row: CandidateRow): MemoryCandidate {
  const payload = JSON.parse(row.payload_json) as MemoryCandidateCreateInput;
  return {
    ...payload,
    id: row.id,
    fingerprint: row.fingerprint,
    runKey: row.run_key ?? undefined,
    status: row.status === "confirming" ? "pending" : row.status,
    confirmedMemoryId: row.confirmed_memory_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function candidateSuppressionKey(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">): string {
  return [input.namespace, input.domain, input.type, input.subject, normalizeForMatch(input.value)].join("|");
}

export function candidateFingerprint(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value" | "sources">): string {
  const sourceIds = input.sources
    .map((source) => `${source.channel}:${source.sessionId}:${source.conversationMessageId}:${source.platformMessageId ?? ""}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify([sourceIds, input.namespace, input.domain, input.type, input.subject, normalizeForMatch(input.value)]))
    .digest("hex");
}

export class MemoryCandidateStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        run_key TEXT,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        confirmed_memory_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_candidates_run_fingerprint
        ON memory_candidates(COALESCE(run_key, ''), fingerprint);
      CREATE INDEX IF NOT EXISTS idx_memory_candidates_status_created
        ON memory_candidates(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS memory_candidate_suppressions (
        suppression_key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);
  }

  create(input: MemoryCandidateCreateInput): MemoryCandidate | null {
    if (this.isSuppressed(input)) return null;
    const now = new Date().toISOString();
    const id = randomUUID();
    const fingerprint = input.fingerprint || candidateFingerprint(input);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO memory_candidates
        (id, fingerprint, run_key, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, fingerprint, input.runKey ?? null, JSON.stringify(input), now, now);
    if (Number(result.changes) === 0) return null;
    return this.get(id);
  }

  get(id: string): MemoryCandidate | null {
    const row = this.db.prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id) as CandidateRow | undefined;
    return row ? parseRow(row) : null;
  }

  list(status?: MemoryCandidateStatus, limit = 200): MemoryCandidate[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
    const rows = status
      ? this.db.prepare("SELECT * FROM memory_candidates WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, safeLimit)
      : this.db.prepare("SELECT * FROM memory_candidates WHERE status != 'confirming' ORDER BY created_at DESC LIMIT ?").all(safeLimit);
    return (rows as CandidateRow[]).map(parseRow);
  }

  reserveConfirmation(id: string): MemoryCandidate | null {
    const now = new Date().toISOString();
    const result = this.db.prepare("UPDATE memory_candidates SET status = 'confirming', updated_at = ? WHERE id = ? AND status = 'pending'").run(now, id);
    return Number(result.changes) > 0 ? this.get(id) : null;
  }

  releaseConfirmation(id: string): void {
    this.db.prepare("UPDATE memory_candidates SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'confirming'").run(new Date().toISOString(), id);
  }

  completeConfirmation(id: string, payload: MemoryCandidateCreateInput, memoryId: string, edited: boolean): MemoryCandidate | null {
    const now = new Date().toISOString();
    const status: MemoryCandidateStatus = edited ? "edited-then-confirmed" : "confirmed";
    this.db.prepare(`
      UPDATE memory_candidates
      SET payload_json = ?, status = ?, confirmed_memory_id = ?, updated_at = ?
      WHERE id = ? AND status = 'confirming'
    `).run(JSON.stringify(payload), status, memoryId, now, id);
    return this.get(id);
  }

  ignore(id: string): MemoryCandidate | null {
    const current = this.get(id);
    if (!current || current.status !== "pending") return null;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO memory_candidate_suppressions (suppression_key, created_at) VALUES (?, ?)")
        .run(candidateSuppressionKey(current), now);
      this.db.prepare("UPDATE memory_candidates SET status = 'ignored', updated_at = ? WHERE id = ? AND status = 'pending'").run(now, id);
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
    return this.get(id);
  }

  isSuppressed(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM memory_candidate_suppressions WHERE suppression_key = ?")
      .get(candidateSuppressionKey(input)));
  }

  close(): void {
    this.db.close();
  }
}

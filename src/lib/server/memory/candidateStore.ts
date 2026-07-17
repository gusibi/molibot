import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { normalizeForMatch } from "#mory";
import type {
  MemoryCandidate,
  MemoryCandidateCreateInput,
  MemoryCandidateStatus,
  MemorySkillDraftSuggestion
} from "$lib/server/memory/types.js";

type CandidateRow = {
  id: string;
  fingerprint: string;
  evidence_key: string | null;
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
    occurrenceCount: payload.occurrenceCount ?? 1,
    evidenceDates: payload.evidenceDates ?? [],
    possibleRelations: payload.possibleRelations ?? [],
    id: row.id,
    fingerprint: row.fingerprint,
    runKey: row.run_key ?? undefined,
    status: row.status === "confirming" ? "pending" : row.status,
    confirmedMemoryId: row.confirmed_memory_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function propositionPolarity(value: string): "positive" | "negative" {
  return /(?:不喜欢|不偏好|不要|别再|避免|讨厌|not\s+prefer|dislike|avoid)/i.test(value) ? "negative" : "positive";
}

export function candidateEvidenceKey(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "path" | "value">): string {
  return [input.namespace, input.domain, input.type, input.path, propositionPolarity(input.value)].join("|");
}

function candidatePropositionKey(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "path">): string {
  return [input.namespace, input.domain, input.type, input.path].join("|");
}

function evidenceDate(source: MemoryCandidateCreateInput["sources"][number]): string | undefined {
  if (!source.observedAt) return undefined;
  const parsed = new Date(source.observedAt);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
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
        evidence_key TEXT,
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
      CREATE TABLE IF NOT EXISTS memory_privacy_suppressions (
        suppression_key TEXT PRIMARY KEY,
        memory_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        restored_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_privacy_suppressions_memory
        ON memory_privacy_suppressions(memory_id, active);
      CREATE TABLE IF NOT EXISTS memory_governance_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL,
        suppression_key TEXT NOT NULL,
        memory_id TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(memory_candidates)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "evidence_key")) {
      this.db.exec("ALTER TABLE memory_candidates ADD COLUMN evidence_key TEXT");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_candidates_evidence_status ON memory_candidates(evidence_key, status)`);
  }

  create(input: MemoryCandidateCreateInput): MemoryCandidate | null {
    if (this.isSuppressed(input) || this.isPrivacySuppressed(input)) return null;
    const now = new Date().toISOString();
    const id = randomUUID();
    const fingerprint = input.fingerprint || candidateFingerprint(input);
    const evidenceKey = candidateEvidenceKey(input);
    const existingRow = this.db.prepare(`
      SELECT * FROM memory_candidates WHERE evidence_key = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1
    `).get(evidenceKey) as CandidateRow | undefined;
    if (existingRow) {
      const existing = parseRow(existingRow);
      const knownSources = new Set(existing.sources.map((source) => `${source.channel}:${source.sessionId}:${source.conversationMessageId}`));
      const newSources = input.sources.filter((source) => !knownSources.has(`${source.channel}:${source.sessionId}:${source.conversationMessageId}`));
      if (newSources.length === 0) return null;
      const knownOccurrences = new Set(existing.sources.map((source) => {
        const date = evidenceDate(source);
        return date ? `${source.sessionId}:${date}` : undefined;
      }).filter(Boolean));
      const newOccurrences = new Set(newSources.map((source) => {
        const date = evidenceDate(source);
        return date ? `${source.sessionId}:${date}` : undefined;
      }).filter((value): value is string => Boolean(value && !knownOccurrences.has(value))));
      const mergedSources = [...existing.sources, ...newSources];
      const evidenceDates = [...new Set(mergedSources.map(evidenceDate).filter((value): value is string => Boolean(value)))].sort();
      const occurrenceCount = (existing.occurrenceCount ?? 1) + newOccurrences.size;
      const payload = {
        ...existing,
        sources: mergedSources,
        evidenceDates,
        occurrenceCount,
        confidence: newOccurrences.size > 0 ? Math.min(0.99, Math.max(existing.confidence, input.confidence) + (0.03 * newOccurrences.size)) : existing.confidence
      };
      this.db.prepare(`UPDATE memory_candidates SET payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(JSON.stringify(payload), now, existing.id);
      return newOccurrences.size > 0 ? this.get(existing.id) : null;
    }
    const initialDates = [...new Set(input.sources.map(evidenceDate).filter((value): value is string => Boolean(value)))].sort();
    const opposite = (this.db.prepare(`SELECT * FROM memory_candidates WHERE status = 'pending'`).all() as CandidateRow[])
      .map(parseRow)
      .find((candidate) => candidatePropositionKey(candidate) === candidatePropositionKey(input)
        && propositionPolarity(candidate.value) !== propositionPolarity(input.value));
    const payload = {
      ...input,
      occurrenceCount: input.occurrenceCount ?? 1,
      evidenceDates: input.evidenceDates ?? initialDates,
      possibleRelations: opposite
        ? [...(input.possibleRelations ?? []), { candidateId: opposite.id, kind: "possible_conflict" as const }]
        : input.possibleRelations ?? []
    };
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO memory_candidates
        (id, fingerprint, evidence_key, run_key, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, fingerprint, evidenceKey, input.runKey ?? null, JSON.stringify(payload), now, now);
    if (Number(result.changes) === 0) return null;
    if (opposite) {
      const nextOpposite = {
        ...opposite,
        possibleRelations: [...(opposite.possibleRelations ?? []), { candidateId: id, kind: "possible_conflict" as const }]
      };
      this.db.prepare(`UPDATE memory_candidates SET payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(JSON.stringify(nextOpposite), now, opposite.id);
    }
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
    return (rows as CandidateRow[]).map(parseRow).sort((left, right) =>
      (right.occurrenceCount ?? 1) - (left.occurrenceCount ?? 1)
      || right.confidence - left.confidence
      || right.updatedAt.localeCompare(left.updatedAt)
    );
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

  setSkillDraftSuggestion(id: string, suggestion: MemorySkillDraftSuggestion): MemoryCandidate | null {
    const current = this.get(id);
    if (!current || current.status !== "pending") return current;
    const payload = { ...current, skillDraftSuggestion: suggestion };
    this.db.prepare("UPDATE memory_candidates SET payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(JSON.stringify(payload), new Date().toISOString(), id);
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

  isPrivacySuppressed(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM memory_privacy_suppressions WHERE suppression_key = ? AND active = 1
    `).get(candidateSuppressionKey(input)));
  }

  isMemoryPrivacySuppressed(memoryId: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM memory_privacy_suppressions WHERE memory_id = ? AND active = 1
    `).get(memoryId));
  }

  suppressForPrivacy(
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">,
    options: { memoryId?: string; idempotencyKey: string; reason: string }
  ): { suppressionKey: string; duplicate: boolean } {
    return this.writePrivacyGovernance("suppress", input, options);
  }

  restorePrivacySuppression(
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">,
    options: { memoryId?: string; idempotencyKey: string; reason: string }
  ): { suppressionKey: string; duplicate: boolean; restored: boolean } {
    const result = this.writePrivacyGovernance("restore", input, options);
    return { ...result, restored: !result.duplicate };
  }

  private writePrivacyGovernance(
    action: "suppress" | "restore",
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">,
    options: { memoryId?: string; idempotencyKey: string; reason: string }
  ): { suppressionKey: string; duplicate: boolean } {
    const suppressionKey = candidateSuppressionKey(input);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO memory_governance_events(
          id, idempotency_key, action, suppression_key, memory_id, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), options.idempotencyKey, action, suppressionKey, options.memoryId ?? null, options.reason, now);
      if (Number(inserted.changes) === 0) {
        this.db.exec("ROLLBACK");
        return { suppressionKey, duplicate: true };
      }
      if (action === "suppress") {
        this.db.prepare(`
          INSERT INTO memory_privacy_suppressions(
            suppression_key, memory_id, active, reason, created_at, restored_at
          ) VALUES (?, ?, 1, ?, ?, NULL)
          ON CONFLICT(suppression_key) DO UPDATE SET
            memory_id = COALESCE(excluded.memory_id, memory_privacy_suppressions.memory_id),
            active = 1,
            reason = excluded.reason,
            restored_at = NULL
        `).run(suppressionKey, options.memoryId ?? null, options.reason, now);
      } else {
        this.db.prepare(`
          UPDATE memory_privacy_suppressions
          SET active = 0, restored_at = ?
          WHERE suppression_key = ? AND active = 1
        `).run(now, suppressionKey);
      }
      this.db.exec("COMMIT");
      return { suppressionKey, duplicate: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

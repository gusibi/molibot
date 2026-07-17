import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { scoreLexical } from "#mory";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { MemoryRecord, MemoryScope } from "$lib/server/memory/types.js";

export interface MemoryMaintenanceTarget {
  ownerId: string;
  botId: string;
  sourceScopes: MemoryScope[];
}

export interface MemoryMaintenanceAction {
  idempotencyKey: string;
  kind: "archive_expired" | "make_dormant" | "review_duplicate";
  scope: MemoryScope;
  memoryId: string;
  relatedMemoryId?: string;
  reason: string;
}

export interface MemoryMaintenancePlan {
  scopeKey: string;
  scannedCount: number;
  actions: MemoryMaintenanceAction[];
}

export class MemoryMaintenanceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_maintenance_leases (
        scope_key TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_maintenance_actions (
        idempotency_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_maintenance_reviews (
        idempotency_key TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        related_memory_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);
  }

  acquire(scopeKey: string, holder: string, nowMs = Date.now(), leaseMs = 10 * 60_000): boolean {
    this.db.prepare(`DELETE FROM memory_maintenance_leases WHERE scope_key = ? AND expires_at <= ?`).run(scopeKey, nowMs);
    return Number(this.db.prepare(`
      INSERT OR IGNORE INTO memory_maintenance_leases(scope_key, holder, expires_at) VALUES (?, ?, ?)
    `).run(scopeKey, holder, nowMs + leaseMs).changes) === 1;
  }

  release(scopeKey: string, holder: string): void {
    this.db.prepare(`DELETE FROM memory_maintenance_leases WHERE scope_key = ? AND holder = ?`).run(scopeKey, holder);
  }

  hasAction(idempotencyKey: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM memory_maintenance_actions WHERE idempotency_key = ?`).get(idempotencyKey));
  }

  completeAction(action: MemoryMaintenanceAction): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_maintenance_actions(idempotency_key, kind, memory_id, completed_at) VALUES (?, ?, ?, ?)
    `).run(action.idempotencyKey, action.kind, action.memoryId, new Date().toISOString());
    if (action.kind === "review_duplicate" && action.relatedMemoryId) {
      this.db.prepare(`INSERT OR IGNORE INTO memory_maintenance_reviews
        (idempotency_key, memory_id, related_memory_id, reason, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)`).run(
          action.idempotencyKey, action.memoryId, action.relatedMemoryId, action.reason, new Date().toISOString()
        );
    }
  }

  listPendingDuplicateReviews(): Array<{ idempotencyKey: string; memoryId: string; relatedMemoryId: string; reason: string }> {
    return (this.db.prepare("SELECT * FROM memory_maintenance_reviews WHERE status = 'pending' ORDER BY created_at DESC").all() as any[])
      .map((row) => ({ idempotencyKey: row.idempotency_key, memoryId: row.memory_id, relatedMemoryId: row.related_memory_id, reason: row.reason }));
  }

  close(): void { this.db.close(); }
}

function scopeKey(target: MemoryMaintenanceTarget): string {
  return createHash("sha256").update(JSON.stringify([target.ownerId, target.botId, target.sourceScopes])).digest("hex");
}

function actionKey(kind: MemoryMaintenanceAction["kind"], record: MemoryRecord): string {
  return createHash("sha256").update(JSON.stringify([kind, record.id, record.version, record.state, record.expiresAt, record.lastInjectedAt, record.injectionCount])).digest("hex");
}

export class MemoryMaintenanceService {
  constructor(
    private readonly gateway: Pick<MemoryGateway, "listForMaintenance" | "delete" | "update" | "compact"> & Partial<Pick<MemoryGateway, "prepareSkillDraftSuggestions">>,
    private readonly store: MemoryMaintenanceStore,
    private readonly isSuccessfulExecution: (sourceEntryId: string) => boolean = () => false
  ) {}

  async plan(target: MemoryMaintenanceTarget, now = new Date()): Promise<MemoryMaintenancePlan> {
    const actions: MemoryMaintenanceAction[] = [];
    let scannedCount = 0;
    for (const rawScope of target.sourceScopes) {
      const scope = { ...rawScope, ownerId: target.ownerId, botId: target.botId };
      const records = await this.gateway.listForMaintenance(scope);
      scannedCount += records.length;
      for (const record of records) {
        if (record.pinned) continue;
        const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
        if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
          actions.push({ idempotencyKey: actionKey("archive_expired", record), kind: "archive_expired", scope, memoryId: record.id, reason: "expired" });
          continue;
        }
        const lastUse = Date.parse(record.lastInjectedAt ?? record.createdAt);
        const unusedDays = Number.isFinite(lastUse) ? (now.getTime() - lastUse) / 86_400_000 : 0;
        if (record.state === "active" && unusedDays >= 90 && record.injectionCount === 0 && (record.utility ?? 0.5) <= 0.5) {
          actions.push({ idempotencyKey: actionKey("make_dormant", record), kind: "make_dormant", scope, memoryId: record.id, reason: "unused_90d" });
        }
      }
      for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
        const left = records[leftIndex];
        if (left.state === "archived") continue;
        for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
          const right = records[rightIndex];
          if (right.state === "archived" || left.pinned || right.pinned || left.domain !== right.domain || left.type !== right.type) continue;
          if (!left.path || left.path !== right.path) continue;
          if (left.content.replace(/\s+/g, " ").trim().toLowerCase() === right.content.replace(/\s+/g, " ").trim().toLowerCase()) continue;
          const similarity = Math.max(scoreLexical(left.content, right.content), scoreLexical(right.content, left.content));
          if (similarity < 0.55) continue;
          const ordered = [left, right].sort((a, b) => a.id.localeCompare(b.id));
          const review: MemoryMaintenanceAction = {
            idempotencyKey: createHash("sha256").update(JSON.stringify(["review_duplicate", ordered[0].id, ordered[1].id, ordered[0].version, ordered[1].version])).digest("hex"),
            kind: "review_duplicate",
            scope,
            memoryId: ordered[0].id,
            relatedMemoryId: ordered[1].id,
            reason: `possible_duplicate:${similarity.toFixed(3)}`
          };
          if (!this.store.hasAction(review.idempotencyKey)) actions.push(review);
        }
      }
    }
    return { scopeKey: scopeKey(target), scannedCount, actions: actions.filter((action) => !this.store.hasAction(action.idempotencyKey)) };
  }

  async run(target: MemoryMaintenanceTarget, options: { dryRun?: boolean; triggerKey: string; now?: Date }): Promise<{
    status: "completed" | "skipped" | "dry_run";
    scannedCount: number;
    plannedCount: number;
    archivedCount: number;
    dormantCount: number;
    compactRemovedCount: number;
    reviewDuplicateCount: number;
  }> {
    const key = scopeKey(target);
    if (!this.store.acquire(key, options.triggerKey)) {
      return { status: "skipped", scannedCount: 0, plannedCount: 0, archivedCount: 0, dormantCount: 0, compactRemovedCount: 0, reviewDuplicateCount: 0 };
    }
    try {
      const plan = await this.plan(target, options.now);
      if (options.dryRun) return { status: "dry_run", scannedCount: plan.scannedCount, plannedCount: plan.actions.length, archivedCount: 0, dormantCount: 0, compactRemovedCount: 0, reviewDuplicateCount: plan.actions.filter((action) => action.kind === "review_duplicate").length };
      let archivedCount = 0;
      let dormantCount = 0;
      let reviewDuplicateCount = 0;
      for (const action of plan.actions) {
        if (action.kind === "review_duplicate") {
          this.store.completeAction(action);
          reviewDuplicateCount += 1;
          continue;
        }
        const changed = action.kind === "archive_expired"
          ? await this.gateway.delete(action.scope, action.memoryId)
          : Boolean(await this.gateway.update(action.scope, action.memoryId, { state: "dormant" }));
        if (!changed) continue;
        this.store.completeAction(action);
        if (action.kind === "archive_expired") archivedCount += 1;
        else dormantCount += 1;
      }
      let compactRemovedCount = 0;
      for (const rawScope of target.sourceScopes) {
        const result = await this.gateway.compact({ ...rawScope, ownerId: target.ownerId, botId: target.botId });
        compactRemovedCount += result.removedCount;
      }
      this.gateway.prepareSkillDraftSuggestions?.(this.isSuccessfulExecution);
      return { status: "completed", scannedCount: plan.scannedCount, plannedCount: plan.actions.length, archivedCount, dormantCount, compactRemovedCount, reviewDuplicateCount };
    } finally {
      this.store.release(key, options.triggerKey);
    }
  }
}

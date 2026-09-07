import { randomUUID } from "node:crypto";
import type {
  LifecycleItemOutcome,
  SessionLifecycleService
} from "$lib/server/sessions/sessionLifecycleService.js";
import type { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import {
  SessionBulkStore,
  type BulkOperationKind,
  type BulkOperationItem,
  type BulkTarget
} from "$lib/server/sessions/sessionBulkStore.js";

export type { BulkOperationKind, BulkTarget };

export interface BulkCounts {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface BulkOperationResult {
  operationId: string;
  kind: BulkOperationKind;
  counts: BulkCounts;
  items: BulkOperationItem[];
}

export interface BulkSelectionSnapshot {
  selectionId: string;
  count: number;
  targets: BulkTarget[];
}

/** Facts the delete confirmation shows: exact count, recovery period, data scope. */
export interface BulkDeletePreview {
  count: number;
  retentionDays: number;
  /** Saved memories and independent artifacts survive; only Session-owned data is removed. */
  retainsMemoriesAndArtifacts: true;
  /** The conversation search projection is removed immediately on delete. */
  searchRemovedImmediately: true;
}

export interface SessionBulkServiceDeps {
  lifecycle: SessionLifecycleService;
  lifecycleRows: SessionLifecycleStore;
  bulk: SessionBulkStore;
  clock?: () => Date;
  trashRetentionDays?: number;
}

const BULK_KINDS: BulkOperationKind[] = ["archive", "restore", "delete"];

function countItems(items: BulkOperationItem[]): BulkCounts {
  const counts: BulkCounts = { total: items.length, succeeded: 0, skipped: 0, failed: 0 };
  for (const item of items) {
    // A crash mid-execution can leave stored `pending` items; they count
    // toward the total but toward no terminal bucket.
    if (item.status === "succeeded" || item.status === "skipped" || item.status === "failed") {
      counts[item.status] += 1;
    }
  }
  return counts;
}

function toStoredItem(target: BulkTarget, outcome: LifecycleItemOutcome): BulkOperationItem {
  if (outcome.status === "succeeded") {
    return {
      conversationId: outcome.conversationId,
      expectedVersion: target.expectedVersion ?? null,
      status: "succeeded",
      reason: null,
      detail: null,
      state: outcome.state,
      version: outcome.version
    };
  }
  if (outcome.status === "skipped") {
    return {
      conversationId: outcome.conversationId,
      expectedVersion: target.expectedVersion ?? null,
      status: "skipped",
      reason: outcome.reason,
      detail: outcome.detail ?? null,
      state: null,
      version: null
    };
  }
  return {
    conversationId: outcome.conversationId,
    expectedVersion: target.expectedVersion ?? null,
    status: "failed",
    reason: outcome.reason,
    detail: null,
    state: null,
    version: null
  };
}

/**
 * Shared application-layer bulk engine. Channel adapters never own batch
 * policy: querying eligibility, ownership rechecks and every mutation run
 * through {@link SessionLifecycleService} per item, so a stale preview or a
 * concurrent change degrades to a `skipped` item instead of a wrong write.
 *
 * Selection model: callers pass either explicit targets (current-page
 * selection) or a server-issued `selectionId` (all-matching snapshot taken at
 * selection time — later arrivals are never silently added). Filter changes
 * clear selection on the client by discarding the id/targets; snapshots here
 * are immutable. Every execution re-verifies qualification and ownership.
 */
export class SessionBulkService {
  private readonly lifecycle: SessionLifecycleService;
  private readonly lifecycleRows: SessionLifecycleStore;
  private readonly bulk: SessionBulkStore;
  private readonly trashRetentionDays: number;

  constructor(deps: SessionBulkServiceDeps) {
    this.lifecycle = deps.lifecycle;
    this.lifecycleRows = deps.lifecycleRows;
    this.bulk = deps.bulk;
    this.trashRetentionDays = deps.trashRetentionDays ?? 30;
  }

  /**
   * Captures an immutable all-matching snapshot: identities plus the versions
   * observed now. Execution still rechecks everything; a version that moved
   * since is reported `stale_version` instead of being acted on.
   */
  createSelection(input: {
    requesterExternalUserId?: string;
    targets: Array<string | BulkTarget>;
  }): BulkSelectionSnapshot {
    const seen = new Set<string>();
    const targets: BulkTarget[] = [];
    for (const entry of input.targets ?? []) {
      const conversationId = (typeof entry === "string" ? entry : entry?.conversationId ?? "").trim();
      if (!conversationId || seen.has(conversationId)) continue;
      seen.add(conversationId);
      const explicitVersion = typeof entry === "string" ? undefined : (entry.expectedVersion ?? undefined);
      const expectedVersion =
        explicitVersion ?? this.lifecycleRows.get(conversationId)?.version ?? null;
      targets.push({ conversationId, expectedVersion });
    }
    if (targets.length === 0) throw new Error("createSelection requires at least one target");
    const selectionId = randomUUID();
    this.bulk.createSelection(
      selectionId,
      input.requesterExternalUserId ?? null,
      targets
    );
    return { selectionId, count: targets.length, targets };
  }

  execute(input: {
    kind: BulkOperationKind;
    requesterExternalUserId?: string;
    targets?: Array<string | BulkTarget>;
    selectionId?: string;
    idempotencyKey: string;
  }): BulkOperationResult {
    if (!BULK_KINDS.includes(input.kind)) throw new Error(`Unknown bulk operation: ${String(input.kind)}`);
    const idempotencyKey = String(input.idempotencyKey ?? "").trim();
    if (!idempotencyKey) throw new Error("execute requires an idempotencyKey");

    // Idempotent replay: the stored result is returned without re-executing,
    // so already-completed actions stay completed and retries stay safe.
    const replayed = this.bulk.findOperationByKey(idempotencyKey);
    if (replayed) return this.toResult(replayed.operationId, replayed.kind, replayed.items);

    const targets = this.resolveTargets(input);
    if (targets.length === 0) throw new Error("execute requires at least one target");

    const requester = input.requesterExternalUserId;
    const operationId = randomUUID();
    this.bulk.createOperation(operationId, idempotencyKey, input.kind, requester ?? null, targets);

    const items: BulkOperationItem[] = [];
    for (const target of targets) {
      const outcome = this.runOne(input.kind, target, requester);
      const stored = toStoredItem(target, outcome);
      this.bulk.updateItem(operationId, stored);
      items.push(stored);
    }
    return { operationId, kind: input.kind, counts: countItems(items), items };
  }

  /**
   * Retries only the failed items of an operation. Succeeded and skipped
   * items are left untouched — completed actions remain idempotent and prior
   * skip decisions are not silently re-litigated.
   */
  retryFailed(input: { operationId: string; requesterExternalUserId?: string }): BulkOperationResult {
    const operationId = String(input.operationId ?? "").trim();
    if (!operationId) throw new Error("retryFailed requires an operationId");
    const stored = this.bulk.getOperation(operationId);
    if (!stored) throw new Error(`Unknown bulk operation: ${operationId}`);
    const requester = input.requesterExternalUserId ?? stored.requesterExternalUserId ?? undefined;
    for (const item of stored.items) {
      if (item.status !== "failed") continue;
      const target: BulkTarget = { conversationId: item.conversationId, expectedVersion: item.expectedVersion };
      const outcome = this.runOne(stored.kind, target, requester);
      this.bulk.updateItem(operationId, toStoredItem(target, outcome));
    }
    const refreshed = this.bulk.getOperation(operationId);
    if (!refreshed) throw new Error(`Bulk operation disappeared: ${operationId}`);
    return this.toResult(refreshed.operationId, refreshed.kind, refreshed.items);
  }

  /** Durable progress: readable after reconnect from the owning store. */
  getOperation(operationId: string): BulkOperationResult | null {
    const stored = this.bulk.getOperation(String(operationId ?? "").trim());
    return stored ? this.toResult(stored.operationId, stored.kind, stored.items) : null;
  }

  /** Exact count plus recovery period and data scope, shown before deletion. */
  describeDelete(count: number): BulkDeletePreview {
    return {
      count,
      retentionDays: this.trashRetentionDays,
      retainsMemoriesAndArtifacts: true,
      searchRemovedImmediately: true
    };
  }

  private resolveTargets(input: {
    targets?: Array<string | BulkTarget>;
    selectionId?: string;
  }): BulkTarget[] {
    if (input.selectionId !== undefined && input.targets !== undefined) {
      throw new Error("execute accepts either targets or selectionId, not both");
    }
    if (input.selectionId !== undefined) {
      const selection = this.bulk.getSelection(input.selectionId);
      if (!selection) throw new Error(`Unknown selection: ${input.selectionId}`);
      return selection.targets;
    }
    const seen = new Set<string>();
    const targets: BulkTarget[] = [];
    for (const entry of input.targets ?? []) {
      const conversationId = (typeof entry === "string" ? entry : entry?.conversationId ?? "").trim();
      if (!conversationId || seen.has(conversationId)) continue;
      seen.add(conversationId);
      targets.push({
        conversationId,
        expectedVersion: typeof entry === "string" ? null : (entry.expectedVersion ?? null)
      });
    }
    return targets;
  }

  private runOne(
    kind: BulkOperationKind,
    target: BulkTarget,
    requesterExternalUserId?: string
  ): LifecycleItemOutcome {
    const base = {
      conversationId: target.conversationId,
      requesterExternalUserId,
      expectedVersion: target.expectedVersion ?? undefined
    };
    try {
      switch (kind) {
        case "archive":
          return this.lifecycle.archive(base);
        case "delete":
          return this.lifecycle.trash(base);
        case "restore": {
          // Dispatch on the current state, then let the single-item operation
          // re-verify ownership and eligibility as usual.
          const state = this.lifecycleRows.get(target.conversationId)?.state;
          return state === "trashed"
            ? this.lifecycle.restoreTrashed(base)
            : this.lifecycle.restoreArchived(base);
        }
      }
    } catch (error) {
      return { status: "failed", conversationId: target.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private toResult(operationId: string, kind: BulkOperationKind, items: BulkOperationItem[]): BulkOperationResult {
    return { operationId, kind, counts: countItems(items), items };
  }
}

import type { BulkTarget } from "$lib/server/sessions/sessionBulkStore.js";
import type {
  ExtractAndArchiveResult,
  SessionExtractionResult
} from "$lib/server/sessions/sessionExtractionService.js";
import type {
  ManagedExtractionBatchResult,
  ManagedExtractionItemResult,
  ManagedExtractionMode
} from "$lib/server/sessions/sessionManagedApi.js";

/** Narrow seam over the T8 service: per-session extract / extract-and-archive. */
export interface ManagedExtractionRunner {
  extract(input: { conversationId: string; requesterExternalUserId?: string }): Promise<SessionExtractionResult>;
  extractAndArchive(input: {
    conversationId: string;
    requesterExternalUserId?: string;
  }): Promise<ExtractAndArchiveResult>;
}

/** Narrow seam over the bulk selection snapshots (all-matching, immutable). */
export interface ManagedExtractionSelections {
  getSelectionTargets(selectionId: string): BulkTarget[];
}

export interface ManagedExtractionBatchDeps {
  extraction: ManagedExtractionRunner;
  selections: ManagedExtractionSelections;
}

export interface ManagedExtractionBatchInput {
  mode: ManagedExtractionMode;
  targets?: BulkTarget[];
  selectionId?: string;
  requesterExternalUserId?: string;
  idempotencyKey?: string;
}

/**
 * Shared batch runner for managed extraction. Resolves explicit targets or a
 * server-issued selection snapshot, then runs each Session through the T8
 * service: `extract` never archives, `extract-and-archive` archives only when
 * the service gate succeeds (saved outputs, nothing pending review, source
 * unchanged). Extraction never deletes — failed, pending-review and
 * concurrent-message items stay unarchived with an explicit reason.
 */
export async function executeManagedExtraction(
  deps: ManagedExtractionBatchDeps,
  input: ManagedExtractionBatchInput
): Promise<ManagedExtractionBatchResult> {
  let targets: BulkTarget[];
  if (input.selectionId !== undefined) {
    targets = deps.selections.getSelectionTargets(input.selectionId);
  } else {
    targets = input.targets ?? [];
  }
  if (targets.length === 0) throw new Error("execute requires at least one target");

  const items: ManagedExtractionItemResult[] = [];
  for (const target of targets) {
    if (input.mode === "extract") {
      const result = await deps.extraction.extract({
        conversationId: target.conversationId,
        requesterExternalUserId: input.requesterExternalUserId
      });
      items.push({
        conversationId: target.conversationId,
        status: result.status,
        archived: false,
        messageRevision: result.messageRevision,
        processedThroughId: result.processedThroughId,
        failureReasons: [...result.failureReasons]
      });
    } else {
      const result = await deps.extraction.extractAndArchive({
        conversationId: target.conversationId,
        requesterExternalUserId: input.requesterExternalUserId
      });
      items.push({
        conversationId: target.conversationId,
        status: result.status,
        archived: result.archived,
        archiveReason: result.archiveReason,
        messageRevision: result.messageRevision,
        processedThroughId: result.processedThroughId,
        failureReasons: [...result.failureReasons]
      });
    }
  }
  return {
    mode: input.mode,
    idempotencyKey: input.idempotencyKey ?? "",
    counts: {
      total: items.length,
      archived: items.filter((item) => item.archived).length,
      failed: items.filter((item) => item.status === "failed").length
    },
    items
  };
}

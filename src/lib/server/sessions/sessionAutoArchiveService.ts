import { randomUUID } from "node:crypto";
import type { SessionAutoArchiveSettings } from "$lib/server/settings/schema.js";
import type {
  ManagedSessionItem,
  ManagedSessionSource
} from "$lib/server/sessions/sessionQueryService.js";
import type { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import type { SessionAutoArchiveStore } from "$lib/server/sessions/sessionAutoArchiveStore.js";

export const AUTO_ARCHIVE_DAY_MS = 86_400_000;

export interface AutoArchiveSweepResult {
  runId: string;
  ran: boolean;
  reason?: string;
  candidateCount: number;
  archivedCount: number;
  skippedCount: number;
  failedCount: number;
  archivedIds: string[];
}

export interface SessionAutoArchiveServiceDeps {
  lifecycle: SessionLifecycleService;
  runs: SessionAutoArchiveStore;
  clock?: () => Date;
}

function managedSourceOf(item: ManagedSessionItem): ManagedSessionSource {
  return item.source;
}

/**
 * Per-session threshold in whole days, or null when the session is exempt.
 * Local and Project sessions always inherit the global threshold in this
 * version; per-BOT overrides apply to external-channel sessions only.
 */
export function resolveAutoArchiveThreshold(
  source: ManagedSessionSource,
  botId: string,
  policy: SessionAutoArchiveSettings
): number | null {
  if (source === "local" || source === "project") return policy.inactiveDays;
  const override = policy.bots[String(botId ?? "").trim() ?? ""];
  if (!override || override.mode === "inherit") return policy.inactiveDays;
  if (override.mode === "disabled") return null;
  return override.inactiveDays ?? policy.inactiveDays;
}

function cutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * AUTO_ARCHIVE_DAY_MS).toISOString();
}

/**
 * Shared application-layer automatic-archive policy. Channel adapters never
 * own cleanup policy: eligibility reuses the same mutation service as manual
 * archive, and scheduling rides the watched-event JSON + Runtime dispatcher.
 *
 * - Preview only counts; saving policy never mutates sessions — the next
 *   scheduled sweep applies fresh checks.
 * - The sweep archives only; it never restores, so changing the threshold
 *   does not automatically restore previously archived sessions.
 * - The switch governs archiving only; trash expiry stays on its own
 *   deletion deadline and is never touched here.
 */
export class SessionAutoArchiveService {
  private readonly lifecycle: SessionLifecycleService;
  private readonly runs: SessionAutoArchiveStore;
  private readonly clock: () => Date;

  constructor(deps: SessionAutoArchiveServiceDeps) {
    this.lifecycle = deps.lifecycle;
    this.runs = deps.runs;
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Last sweep result for the management page. No per-session notifications. */
  getLastRun(): ReturnType<SessionAutoArchiveStore["getLastRun"]> {
    return this.runs.getLastRun();
  }

  /** Read-only affected-count preview for policy editing. Never mutates. */
  previewCandidates(policy: SessionAutoArchiveSettings, now?: Date): ManagedSessionItem[] {
    return this.collectQualifying(policy, now ?? this.clock());
  }

  previewCount(policy: SessionAutoArchiveSettings, now?: Date): number {
    return this.previewCandidates(policy, now).length;
  }

  /**
   * Daily sweep. Skips busy, protected (retain), trashed and already-archived
   * sessions; only `active` rows are enumerated. Concurrent or replayed sweeps
   * converge: `archive()` is idempotent and version conflicts degrade to
   * skips. Progress and the last-run result persist in the owning store.
   */
  runSweep(policy: SessionAutoArchiveSettings, opts?: { runId?: string; now?: Date }): AutoArchiveSweepResult {
    const now = opts?.now ?? this.clock();
    if (!policy.enabled) {
      return {
        runId: opts?.runId ?? `skipped-${randomUUID()}`,
        ran: false,
        reason: "disabled",
        candidateCount: 0,
        archivedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        archivedIds: []
      };
    }
    // Downtime reconciliation first: stale `running` rows become `interrupted`
    // and this sweep does one fresh pass — no catch-up per missed day.
    this.runs.reconcileInterrupted();
    const runId = String(opts?.runId ?? randomUUID()).trim() || randomUUID();
    this.runs.beginRun(runId);
    const qualifying = this.collectQualifying(policy, now);
    let archivedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const archivedIds: string[] = [];
    for (const item of qualifying) {
      if (item.retain) {
        skippedCount += 1;
        continue;
      }
      const outcome = this.lifecycle.archive({ conversationId: item.conversationId });
      if (outcome.status === "succeeded") {
        archivedCount += 1;
        archivedIds.push(item.conversationId);
      } else if (outcome.status === "skipped") {
        skippedCount += 1;
      } else {
        failedCount += 1;
      }
    }
    this.runs.finishRun(runId, {
      candidateCount: qualifying.length,
      archivedCount,
      skippedCount,
      failedCount
    });
    return {
      runId,
      ran: true,
      candidateCount: qualifying.length,
      archivedCount,
      skippedCount,
      failedCount,
      archivedIds
    };
  }

  private collectQualifying(policy: SessionAutoArchiveSettings, now: Date): ManagedSessionItem[] {
    const nowMs = now.getTime();
    const out: ManagedSessionItem[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const page = this.lifecycle.queryManaged({ state: "active", limit, offset });
      if (page.items.length === 0) break;
      for (const item of page.items) {
        const threshold = resolveAutoArchiveThreshold(managedSourceOf(item), item.botId, policy);
        if (threshold === null) continue;
        const activity = item.lastActivityAt ?? item.createdAt ?? null;
        if (!activity) continue;
        if (activity <= cutoffIso(nowMs, threshold)) out.push(item);
      }
      offset += page.items.length;
      if (offset >= page.total) break;
    }
    return out;
  }
}

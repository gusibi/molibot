/**
 * moryMetrics.ts
 *
 * Lightweight observability counters for mory pipelines.
 */

export interface MoryMetricsSnapshot {
  writesInserted: number;
  writesUpdated: number;
  writesSkipped: number;
  duplicateSkips: number;
  conflictCount: number;
  retrievalRequests: number;
  retrievalHits: number;
  retrievalMisses: number;
  archivedCount: number;
  tokenCost: number;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MoryMetrics {
  private state: Omit<MoryMetricsSnapshot, "updatedAt"> = {
    writesInserted: 0,
    writesUpdated: 0,
    writesSkipped: 0,
    duplicateSkips: 0,
    conflictCount: 0,
    retrievalRequests: 0,
    retrievalHits: 0,
    retrievalMisses: 0,
    archivedCount: 0,
    tokenCost: 0,
  };

  recordWrite(action: "insert" | "update" | "skip", duplicate = false): void {
    if (action === "insert") this.state.writesInserted += 1;
    if (action === "update") this.state.writesUpdated += 1;
    if (action === "skip") this.state.writesSkipped += 1;
    if (duplicate) this.state.duplicateSkips += 1;
  }

  recordConflict(count = 1): void {
    this.state.conflictCount += Math.max(0, count);
  }

  recordRetrieval(hitCount: number): void {
    this.state.retrievalRequests += 1;
    if (hitCount > 0) {
      this.state.retrievalHits += 1;
    } else {
      this.state.retrievalMisses += 1;
    }
  }

  recordArchived(count: number): void {
    this.state.archivedCount += Math.max(0, count);
  }

  recordTokenCost(tokens: number): void {
    this.state.tokenCost += Math.max(0, Math.round(tokens));
  }

  snapshot(): MoryMetricsSnapshot {
    return {
      ...this.state,
      updatedAt: nowIso(),
    };
  }
}

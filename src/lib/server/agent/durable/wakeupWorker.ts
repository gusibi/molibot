import { momWarn } from "$lib/server/agent/common/log.js";
import { isStorageError } from "./storageErrors.js";
import type { DurableWakeup } from "./types.js";
import type { DurableExecutionStore } from "./store.js";

/**
 * What one wakeup consumed. The worker needs the difference because only
 * process-level failures are retried; a business failure is already persisted
 * by the runtime as an attempt outcome and replaying it would duplicate work.
 */
export type WakeupExecutionOutcome =
  | { kind: "done" }
  | { kind: "discarded" }
  | { kind: "retry"; error: string }
  | { kind: "fatal"; error: string };

export interface DurableWakeupWorkerOptions {
  store: DurableExecutionStore;
  ownerId: string;
  execute: (wakeup: DurableWakeup) => Promise<WakeupExecutionOutcome>;
  intervalMs?: number;
  batch?: number;
  now?: () => Date;
  random?: () => number;
  retryDelayMs?: number;
}

/**
 * Consumes the wakeup queue. It only decides *when* the runtime looks at an
 * execution; it never replays an attempt or interprets business state.
 *
 * A commit in this process kicks a tick immediately; the interval is the
 * cross-process and post-crash floor, matching the latency of the watcher this
 * queue replaces.
 */
export class DurableWakeupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private ticking = false;
  private stopping = false;
  private started = false;
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly options: DurableWakeupWorkerOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const interval = Math.max(100, Math.round(this.options.intervalMs ?? 1000));
    this.timer = setInterval(() => { void this.tick(); }, interval);
    this.unsubscribe = this.options.store.subscribe(() => this.kick());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.allSettled([...this.inflight]);
    this.started = false;
  }

  /** Called by the store subscription; never blocks the committing caller. */
  kick(): void {
    if (this.stopping) return;
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    const store = this.options.store;
    if (store.fatalError) {
      this.stopping = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.ticking = true;
    try {
      const available = Math.max(1, this.options.batch ?? 4) - this.inflight.size;
      if (available <= 0) return;
      const rows = store.claimDueWakeups(this.options.ownerId, available, this.now());
      for (const row of rows) {
        const task = this.runOne(row).finally(() => {
          this.inflight.delete(task);
          if (this.started) this.kick();
        });
        this.inflight.add(task);
      }
    } catch (error) {
      if (isStorageError(error)) store.markFatal(error);
      momWarn("durableExecution", "wakeup_claim_failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.ticking = false;
    }
    // Waiting callers can observe settlement without reserving the dispatcher.
    await Promise.allSettled([...this.inflight]);
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  private async runOne(wakeup: DurableWakeup): Promise<void> {
    const store = this.options.store;
    let outcome: WakeupExecutionOutcome;
    try {
      outcome = await this.options.execute(wakeup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { kind: "retry", error: message };
    }
    try {
      if (outcome.kind === "done") store.settleWakeup(wakeup.id, { status: "done" });
      else if (outcome.kind === "discarded") store.settleWakeup(wakeup.id, { status: "discarded" });
      else if (outcome.kind === "fatal") {
        store.markFatal(outcome.error);
        store.settleWakeup(wakeup.id, { status: "failed", error: outcome.error });
      } else {
        const retried = store.backoffWakeup(wakeup, outcome.error, this.now(), this.options.random);
        if (retried.status === "failed") {
          momWarn("durableExecution", "wakeup_retry_exhausted", {
            executionId: wakeup.executionId,
            wakeupId: wakeup.id,
            attempts: wakeup.attempts,
            error: outcome.error
          });
        }
      }
    } catch (error) {
      if (isStorageError(error)) store.markFatal(error);
      momWarn("durableExecution", "wakeup_settle_failed", {
        wakeupId: wakeup.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

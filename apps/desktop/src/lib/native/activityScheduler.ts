export type ActivityPolicy = {
  initialIntervalMs: number;
  fastPollDurationMs: number;
  maximumIntervalMs: number;
  backoffFactor: number;
};

export type ActivityTimer = number | ReturnType<typeof setTimeout>;

export type ActivityClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ActivityTimer;
  clearTimeout(handle: ActivityTimer): void;
};

export type ActivityVisibility = {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
};

const defaultClock: ActivityClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle)
};

export const desktopStatusPolicy: ActivityPolicy = {
  initialIntervalMs: 1_000,
  fastPollDurationMs: 8_000,
  maximumIntervalMs: 10_000,
  backoffFactor: 2
};

export const interactiveActivityPolicy: ActivityPolicy = {
  initialIntervalMs: 3_000,
  fastPollDurationMs: 15_000,
  maximumIntervalMs: 30_000,
  backoffFactor: 2
};

export const mediaActivityPolicy: ActivityPolicy = {
  initialIntervalMs: 5_000,
  fastPollDurationMs: 30_000,
  maximumIntervalMs: 15_000,
  backoffFactor: 2
};

export const backgroundActivityPolicy: ActivityPolicy = {
  initialIntervalMs: 15_000,
  fastPollDurationMs: 30_000,
  maximumIntervalMs: 60_000,
  backoffFactor: 2
};

export const reconnectActivityPolicy: ActivityPolicy = {
  initialIntervalMs: 4_000,
  fastPollDurationMs: 16_000,
  maximumIntervalMs: 32_000,
  backoffFactor: 2
};

export const agentActivityPolicy: ActivityPolicy = {
  initialIntervalMs: 2_500,
  fastPollDurationMs: 15_000,
  maximumIntervalMs: 30_000,
  backoffFactor: 2
};

export const documentActivityVisibility: ActivityVisibility = {
  hidden: () => document.hidden,
  subscribe(listener) {
    const onVisibilityChange = () => {
      if (!document.hidden) listener();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }
};

export class ActivityScheduler {
  private disposed = false;
  private inFlight = false;
  private queuedWake = false;
  private timer: ActivityTimer | null = null;
  private intervalMs: number;
  private startedAt = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly policy: ActivityPolicy,
    private readonly task: () => Promise<void>,
    private readonly visibility: ActivityVisibility,
    private readonly clock: ActivityClock = defaultClock
  ) {
    this.intervalMs = policy.initialIntervalMs;
  }

  start(): void {
    if (this.disposed || this.unsubscribe) return;
    this.startedAt = this.clock.now();
    this.unsubscribe = this.visibility.subscribe(() => this.wake("visibility"));
    this.wake("start");
  }

  wake(_reason: "start" | "visibility" | "retry" | "manual"): void {
    if (this.disposed || this.visibility.hidden()) return;
    if (this.inFlight) {
      this.queuedWake = true;
      return;
    }
    this.clearTimer();
    void this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.queuedWake = false;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async run(): Promise<void> {
    if (this.disposed || this.visibility.hidden() || this.inFlight) return;
    this.inFlight = true;
    try {
      await this.task();
    } finally {
      this.inFlight = false;
      if (this.disposed || this.visibility.hidden()) return;
      if (this.queuedWake) {
        this.queuedWake = false;
        this.wake("manual");
        return;
      }
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    const elapsedMs = this.clock.now() - this.startedAt;
    const nextIntervalMs = elapsedMs < this.policy.fastPollDurationMs
      ? this.policy.initialIntervalMs
      : Math.min(
          this.policy.maximumIntervalMs,
          Math.round(this.intervalMs * this.policy.backoffFactor)
        );
    this.intervalMs = nextIntervalMs;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.wake("manual");
    }, nextIntervalMs);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

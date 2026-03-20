import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

export interface EventStatus {
  state: "pending" | "running" | "completed" | "skipped" | "error";
  completedAt?: string;
  lastTriggeredAt?: string;
  runCount?: number;
  reason?: string;
  lastError?: string;
  startedAt?: string;
  runId?: string;
  runningSlotKey?: string;
  lastSlotKey?: string;
}

export type EventDeliveryMode = "text" | "agent";

interface EventBase {
  chatId: string;
  text: string;
  // text: send text directly; agent: run through AI agent first, then send result.
  delivery?: EventDeliveryMode;
  status?: EventStatus;
}

export interface ImmediateEvent {
  type: "immediate";
}

export interface OneShotEvent {
  type: "one-shot";
  at: string;
}

export interface PeriodicEvent {
  type: "periodic";
  schedule: string;
  timezone: string;
}

export type MomEvent = (ImmediateEvent | OneShotEvent | PeriodicEvent) & EventBase;

interface CronFieldRule {
  values: Set<number> | null;
  step: number;
  min: number;
  max: number;
}

function parseCronField(source: string, min: number, max: number): CronFieldRule {
  const raw = source.trim();
  if (!raw || raw === "*") {
    return { values: null, step: 1, min, max };
  }

  if (raw.startsWith("*/")) {
    const step = Number.parseInt(raw.slice(2), 10);
    if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid step: ${source}`);
    return { values: null, step, min, max };
  }

  const out = new Set<number>();
  const segments = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    if (segment.includes("-")) {
      const [startRaw, endRaw] = segment.split("-", 2);
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new Error(`Invalid range in cron: ${segment}`);
      }
      for (let i = start; i <= end; i++) {
        if (i < min || i > max) throw new Error(`Out of range: ${i}`);
        out.add(i);
      }
      continue;
    }

    const value = Number.parseInt(segment, 10);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Out of range: ${segment}`);
    }
    out.add(value);
  }

  return { values: out, step: 1, min, max };
}

function matchCronField(rule: CronFieldRule, value: number): boolean {
  if (rule.values) {
    return rule.values.has(value);
  }
  return (value - rule.min) % rule.step === 0;
}

interface ParsedCron {
  minute: CronFieldRule;
  hour: CronFieldRule;
  day: CronFieldRule;
  month: CronFieldRule;
  weekday: CronFieldRule;
}

function parseCron(schedule: string): ParsedCron {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron '${schedule}', expected 5 fields`);
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    day: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    weekday: parseCronField(parts[4], 0, 6)
  };
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  return (
    matchCronField(parsed.minute, date.getMinutes()) &&
    matchCronField(parsed.hour, date.getHours()) &&
    matchCronField(parsed.day, date.getDate()) &&
    matchCronField(parsed.month, date.getMonth() + 1) &&
    matchCronField(parsed.weekday, date.getDay())
  );
}

interface PeriodicSchedule {
  parsed: ParsedCron;
  event: MomEvent;
  filename: string;
  lastTick: string;
}

export class EventsWatcher {
  private static readonly DEFAULT_RUNNING_TTL_MS = 15 * 60 * 1000;
  private readonly oneShotTimers = new Map<string, NodeJS.Timeout>();
  private readonly periodic = new Map<string, PeriodicSchedule>();
  private watcher: FSWatcher | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly knownFiles = new Set<string>();
  private readonly runningTtlMs: number;

  constructor(
    private readonly eventsDir: string,
    private readonly onEvent: (event: MomEvent, filename: string) => Promise<void> | void
  ) {
    const rawRunningTtlMs = Number.parseInt(
      process.env.MOLIBOT_EVENT_RUNNING_TTL_MS ?? process.env.EVENT_RUNNING_TTL_MS ?? "",
      10
    );
    this.runningTtlMs = Number.isFinite(rawRunningTtlMs) && rawRunningTtlMs > 0
      ? rawRunningTtlMs
      : EventsWatcher.DEFAULT_RUNNING_TTL_MS;
  }

  private isRunningLockEnabled(): boolean {
    const raw = String(
      process.env.MOLIBOT_EVENT_RUNNING_LOCK_ENABLED ?? process.env.EVENT_RUNNING_LOCK_ENABLED ?? "true"
    )
      .trim()
      .toLowerCase();
    return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
  }

  private buildMinuteSlotKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  private isRunningLeaseStale(status: EventStatus | undefined, nowMs: number): boolean {
    if (status?.state !== "running") return false;
    const startedMs = Date.parse(String(status.startedAt ?? ""));
    if (!Number.isFinite(startedMs)) return true;
    return nowMs - startedMs > this.runningTtlMs;
  }

  private refreshPeriodicEntry(filename: string, event: MomEvent): void {
    const entry = this.periodic.get(filename);
    if (!entry) return;
    entry.event = event;
  }

  start(): void {
    if (!existsSync(this.eventsDir)) {
      mkdirSync(this.eventsDir, { recursive: true });
    }

    const files = readdirSync(this.eventsDir).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      this.handleFile(file);
    }

    this.watcher = watch(this.eventsDir, (_event, filename) => {
      if (!filename || !filename.endsWith(".json")) return;
      const existing = this.debounce.get(filename);
      if (existing) clearTimeout(existing);
      this.debounce.set(
        filename,
        setTimeout(() => {
          this.debounce.delete(filename);
          this.handleFileChange(filename);
        }, 100)
      );
    });

    this.tickTimer = setInterval(() => {
      this.tickPeriodic();
    }, 1000);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    for (const t of this.oneShotTimers.values()) clearTimeout(t);
    for (const t of this.debounce.values()) clearTimeout(t);

    this.oneShotTimers.clear();
    this.periodic.clear();
    this.debounce.clear();
    this.knownFiles.clear();
  }

  private handleFileChange(filename: string): void {
    const full = join(this.eventsDir, filename);
    if (!existsSync(full)) {
      this.cancel(filename);
      this.knownFiles.delete(filename);
      return;
    }

    this.cancel(filename);
    this.handleFile(filename);
  }

  private handleFile(filename: string): void {
    const full = join(this.eventsDir, filename);
    try {
      const stat = statSync(full);
      if (!stat.isFile()) return;

      const raw = readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as MomEvent;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid JSON object");
      }
      const normalized = this.normalizeEventDelivery(parsed);
      if (normalized.delivery !== parsed.delivery) {
        this.updateEventFile(filename, () => normalized);
      }

      if (this.isCompleted(normalized)) {
        this.cancel(filename);
        this.knownFiles.add(filename);
        return;
      }

      if (normalized.type === "immediate") {
        this.dispatchEvent(normalized, filename);
      } else if (normalized.type === "one-shot") {
        const at = new Date(normalized.at).getTime();
        if (!Number.isFinite(at) || at <= Date.now()) {
          this.markSkipped(filename, normalized, "expired_or_invalid_time");
          return;
        }
        const timer = setTimeout(() => {
          this.oneShotTimers.delete(filename);
          this.dispatchEvent(normalized, filename);
        }, at - Date.now());
        this.oneShotTimers.set(filename, timer);
        this.knownFiles.add(filename);
      } else if (normalized.type === "periodic") {
        const cron = parseCron(normalized.schedule);
        this.periodic.set(filename, {
          parsed: cron,
          event: normalized,
          filename,
          lastTick: ""
        });
        this.knownFiles.add(filename);
      } else {
        throw new Error(`Unknown event type: ${(parsed as { type?: string }).type ?? "unknown"}`);
      }
    } catch (error) {
      this.cancel(filename);
      this.knownFiles.add(filename);
      const message = error instanceof Error ? error.message : String(error);
      this.markError(filename, message);
    }
  }

  private tickPeriodic(): void {
    const now = new Date();
    const slotKey = this.buildMinuteSlotKey(now);
    const nowMs = now.getTime();

    for (const entry of this.periodic.values()) {
      if (entry.lastTick === slotKey) continue;
      if (!cronMatches(entry.parsed, now)) continue;
      if (entry.event.status?.lastSlotKey === slotKey) {
        entry.lastTick = slotKey;
        continue;
      }
      if (entry.event.status?.state === "running" && !this.isRunningLeaseStale(entry.event.status, nowMs)) {
        entry.lastTick = slotKey;
        continue;
      }
      entry.lastTick = slotKey;
      this.dispatchEvent(entry.event, entry.filename, slotKey);
    }
  }

  private dispatchEvent(event: MomEvent, filename: string, slotKey?: string): void {
    if (event.type === "periodic" && this.isRunningLockEnabled()) {
      const lock = this.tryAcquirePeriodicRunLock(filename, slotKey ?? this.buildMinuteSlotKey(new Date()));
      if (!lock) return;

      Promise.resolve(this.onEvent(lock.event, filename))
        .then(() => {
          this.markDone(filename, lock.event, "executed", lock.slotKey, lock.runId);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.markError(filename, message, lock.slotKey, lock.runId);
        });
      return;
    }

    Promise.resolve(this.onEvent(event, filename))
      .then(() => {
        this.markDone(filename, event, "executed", slotKey);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.markError(filename, message, slotKey);
      });
  }

  private tryAcquirePeriodicRunLock(
    filename: string,
    slotKey: string
  ): { event: MomEvent; slotKey: string; runId: string } | null {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const runId = `${filename}:${nowMs}:${Math.random().toString(36).slice(2, 8)}`;
    let acquired = false;
    let lockedEvent: MomEvent | null = null;

    const next = this.updateEventFile(filename, (current) => {
      if (current.type !== "periodic") return current;
      const status = this.normalizeStatus(current.status);
      if (status.lastSlotKey === slotKey) {
        return null;
      }
      if (status.state === "running" && !this.isRunningLeaseStale(status, nowMs)) {
        return null;
      }

      acquired = true;
      const result: MomEvent = {
        ...current,
        delivery: this.resolveDeliveryMode(current),
        status: {
          ...status,
          state: "running",
          completedAt: undefined,
          reason: "running",
          lastError: undefined,
          startedAt: nowIso,
          runId,
          runningSlotKey: slotKey
        }
      };
      lockedEvent = result;
      return result;
    });

    if (!acquired || !next || !lockedEvent) return null;
    this.refreshPeriodicEntry(filename, next);
    return { event: next, slotKey, runId };
  }

  private cancel(filename: string): void {
    const oneShot = this.oneShotTimers.get(filename);
    if (oneShot) {
      clearTimeout(oneShot);
      this.oneShotTimers.delete(filename);
    }
    this.periodic.delete(filename);
  }

  private isCompleted(event: MomEvent): boolean {
    return event.status?.state === "completed";
  }

  private normalizeStatus(status: EventStatus | undefined): EventStatus {
    return {
      state: status?.state ?? "pending",
      ...(status ?? {})
    };
  }

  private resolveDeliveryMode(event: MomEvent): EventDeliveryMode {
    const raw = String(event.delivery ?? "").trim().toLowerCase();
    if (raw === "text") return "text";
    if (raw === "agent") return "agent";
    return "agent";
  }

  private normalizeEventDelivery(event: MomEvent): MomEvent {
    const delivery = this.resolveDeliveryMode(event);
    if (event.delivery === delivery) return event;
    return {
      ...event,
      delivery
    };
  }

  private markDone(filename: string, event: MomEvent, reason: string, slotKey?: string, runId?: string): void {
    const triggeredAt = new Date().toISOString();
    if (event.type === "periodic") {
      const next = this.updateEventFile(filename, (current) => {
        const status = this.normalizeStatus(current.status);
        if (runId && status.runId && status.runId !== runId) return null;
        return {
          ...current,
          delivery: this.resolveDeliveryMode(current),
          status: {
            ...status,
            state: "pending",
            completedAt: undefined,
            lastTriggeredAt: triggeredAt,
            runCount: (status.runCount ?? 0) + 1,
            reason,
            lastSlotKey: slotKey ?? status.runningSlotKey ?? status.lastSlotKey,
            runningSlotKey: undefined,
            startedAt: undefined,
            runId: undefined,
            lastError: undefined
          }
        };
      });
      if (next) this.refreshPeriodicEntry(filename, next);
      this.knownFiles.add(filename);
      return;
    }

    this.updateEventFile(filename, (current) => ({
      ...current,
      delivery: this.resolveDeliveryMode(current),
      status: {
        ...(current.status ?? {}),
        state: "completed",
        completedAt: triggeredAt,
        lastTriggeredAt: triggeredAt,
        runCount: (current.status?.runCount ?? event.status?.runCount ?? 0) + 1,
        reason
      }
    }));
    this.cancel(filename);
    this.knownFiles.add(filename);
  }

  private markSkipped(filename: string, event: MomEvent, reason: string): void {
    this.updateEventFile(filename, (current) => ({
      ...current,
      delivery: this.resolveDeliveryMode(current),
      status: {
        ...(current.status ?? {}),
        state: "skipped",
        completedAt: new Date().toISOString(),
        runCount: current.status?.runCount ?? event.status?.runCount ?? 0,
        reason
      }
    }));
    this.cancel(filename);
    this.knownFiles.add(filename);
  }

  private markError(filename: string, message: string, slotKey?: string, runId?: string): void {
    const next = this.updateEventFile(filename, (current) => {
      const status = this.normalizeStatus(current.status);
      if (runId && status.runId && status.runId !== runId) return null;
      return {
        ...current,
        delivery: this.resolveDeliveryMode(current),
        status: {
          ...status,
          state: "error",
          completedAt: status.completedAt,
          runCount: status.runCount ?? 0,
          reason: status.reason,
          lastError: message,
          lastSlotKey: slotKey ?? status.runningSlotKey ?? status.lastSlotKey,
          runningSlotKey: undefined,
          startedAt: undefined,
          runId: undefined
        }
      };
    });
    if (next && next.type === "periodic") {
      this.refreshPeriodicEntry(filename, next);
    }
  }

  private updateEventFile(filename: string, updater: (event: MomEvent) => MomEvent | null): MomEvent | null {
    const full = join(this.eventsDir, filename);
    try {
      const raw = readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as MomEvent;
      if (!parsed || typeof parsed !== "object") return null;
      const next = updater(parsed);
      if (!next) return null;
      writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      return next;
    } catch {
      return null;
    }
  }
}

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

export interface EventStatus {
  state: "pending" | "completed" | "skipped" | "error";
  completedAt?: string;
  runCount?: number;
  reason?: string;
  lastError?: string;
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
  event: PeriodicEvent;
  filename: string;
  lastTick: string;
}

export class EventsWatcher {
  private readonly oneShotTimers = new Map<string, NodeJS.Timeout>();
  private readonly periodic = new Map<string, PeriodicSchedule>();
  private watcher: FSWatcher | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly knownFiles = new Set<string>();

  constructor(
    private readonly eventsDir: string,
    private readonly onEvent: (event: MomEvent, filename: string) => Promise<void> | void
  ) {}

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
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

    for (const entry of this.periodic.values()) {
      if (entry.lastTick === key) continue;
      if (!cronMatches(entry.parsed, now)) continue;
      entry.lastTick = key;
      this.onEvent(entry.event, entry.filename);
    }
  }

  private dispatchEvent(event: MomEvent, filename: string): void {
    Promise.resolve(this.onEvent(event, filename))
      .then(() => {
        this.markDone(filename, event, "executed");
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.markError(filename, message);
      });
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

  private markDone(filename: string, event: MomEvent, reason: string): void {
    const runCount = (event.status?.runCount ?? 0) + 1;
    this.updateEventFile(filename, (current) => ({
      ...current,
      delivery: this.resolveDeliveryMode(current),
      status: {
        ...(current.status ?? {}),
        state: "completed",
        completedAt: new Date().toISOString(),
        runCount,
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

  private markError(filename: string, message: string): void {
    this.updateEventFile(filename, (current) => ({
      ...current,
      delivery: this.resolveDeliveryMode(current),
      status: {
        ...(current.status ?? {}),
        state: "error",
        completedAt: current.status?.completedAt,
        runCount: current.status?.runCount ?? 0,
        reason: current.status?.reason,
        lastError: message
      }
    }));
  }

  private updateEventFile(filename: string, updater: (event: MomEvent) => MomEvent): void {
    const full = join(this.eventsDir, filename);
    try {
      const raw = readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as MomEvent;
      if (!parsed || typeof parsed !== "object") return;
      const next = updater(parsed);
      writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    } catch {
      // ignore
    }
  }
}

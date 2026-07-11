import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  getEventExecutionLeaseStore,
  type EventExecutionLease,
  type EventExecutionLeaseStore
} from "$lib/server/agent/eventsLeaseStore.js";

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
export type EventExecutionMode = "channel" | "internal";
export type InternalEventKind = "memory-reflection" | "daily-materials";

export interface InternalEventTarget {
  ownerId: string;
  botId: string;
  timezone: string;
  sourceScopes: Array<{ channel: string; externalUserId: string; projectId?: string; shareOwner?: boolean }>;
}

// fresh: run each trigger in a brand-new session (no accumulated chat history);
// chat: append to the chat's active session (legacy behavior).
export type EventSessionMode = "fresh" | "chat";

interface EventBase {
  taskId?: string;
  // Missing keeps historical event files enabled.
  enabled?: boolean;
  chatId: string;
  text: string;
  // text: send text directly; agent: run through AI agent first, then send result.
  delivery?: EventDeliveryMode;
  execution?: EventExecutionMode;
  internal?: {
    kind: InternalEventKind;
    notificationChatId?: string;
    target: InternalEventTarget;
    promptPath?: string;
    output?: { projectId: string; dir?: string };
  };
  sessionMode?: EventSessionMode;
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

const TASK_ID_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Turn an arbitrary name into a short, url-safe, kebab slug for a taskId prefix.
// Falls back to "task" when nothing usable remains.
export function slugifyTaskId(input: string | undefined): string {
  const slug = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "task";
}

function randomTaskIdSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TASK_ID_SUFFIX_ALPHABET[Math.floor(Math.random() * TASK_ID_SUFFIX_ALPHABET.length)];
  }
  return out;
}

// Globally-unique-ish taskId in the readable form `<slug>-<4 char random>`,
// e.g. "ai-news-daily-8x2k". Callers that can see sibling events should route
// through a uniqueness check (see createEventTool) to guarantee no duplicates.
export function createEventTaskId(slug?: string): string {
  return `${slugifyTaskId(slug)}-${randomTaskIdSuffix()}`;
}

export function taskSessionRetentionMs(days: number | undefined): number | undefined {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return undefined;
  return Math.round(days) * 24 * 60 * 60 * 1000;
}

// Periodic agent tasks default to fresh sessions so daily report runs do not
// keep paying for accumulated history; other event types stay in the chat session.
export function resolveEventSessionMode(event: MomEvent): EventSessionMode {
  const raw = String(event.sessionMode ?? "").trim().toLowerCase();
  if (raw === "fresh") return "fresh";
  if (raw === "chat") return "chat";
  return event.type === "periodic" ? "fresh" : "chat";
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

interface PeriodicSchedule {
  parsed: ParsedCron;
  event: MomEvent;
  filename: string;
  lastTick: string;
}

export interface EventExecutionSettings {
  executionTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface EventDispatchTimeoutContext {
  event: MomEvent;
  filename: string;
  runId: string;
  lease: EventExecutionLease;
}

export interface EventsWatcherOptions {
  channel?: string;
  leaseScope?: string;
  getExecutionSettings?: () => EventExecutionSettings;
  onTimeout?: (context: EventDispatchTimeoutContext) => Promise<void> | void;
  leaseStore?: EventExecutionLeaseStore;
}

export class EventsWatcher {
  private static readonly DEFAULT_RUNNING_TTL_MS = 15 * 60 * 1000;
  private static readonly DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private static readonly DEFAULT_RETRY_DELAY_MS = 5000;
  private readonly oneShotTimers = new Map<string, NodeJS.Timeout>();
  private readonly periodic = new Map<string, PeriodicSchedule>();
  private watcher: FSWatcher | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly knownFiles = new Set<string>();
  private readonly runningTtlMs: number;

  constructor(
    private readonly eventsDir: string,
    private readonly onEvent: (event: MomEvent, filename: string) => Promise<void> | void,
    private readonly options: EventsWatcherOptions = {}
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

  private getExecutionSettings(): EventExecutionSettings {
    const settings = this.options.getExecutionSettings?.();
    return {
      executionTimeoutMs: Math.max(
        1000,
        Math.round(settings?.executionTimeoutMs ?? EventsWatcher.DEFAULT_EXECUTION_TIMEOUT_MS)
      ),
      maxAttempts: Math.max(1, Math.round(settings?.maxAttempts ?? EventsWatcher.DEFAULT_MAX_ATTEMPTS)),
      retryDelayMs: Math.max(0, Math.round(settings?.retryDelayMs ?? EventsWatcher.DEFAULT_RETRY_DELAY_MS))
    };
  }

  private getLeaseStore(): EventExecutionLeaseStore {
    return this.options.leaseStore ?? getEventExecutionLeaseStore();
  }

  private getLeaseScope(): string {
    return this.options.leaseScope ?? this.options.channel ?? "default";
  }

  private createRunId(filename: string): string {
    return `${filename}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
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

    this.getLeaseStore().recoverStaleRunning();

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
      const identified = this.ensureTaskId(normalized);
      if (identified.delivery !== parsed.delivery || identified.taskId !== parsed.taskId) {
        this.updateEventFile(filename, () => identified);
      }

      if (identified.enabled === false) {
        this.cancel(filename);
        this.knownFiles.add(filename);
        return;
      }

      if (this.isCompleted(identified)) {
        this.cancel(filename);
        this.knownFiles.add(filename);
        return;
      }

      if (this.resumeRecoveredLease(filename, identified)) {
        this.knownFiles.add(filename);
        return;
      }

      if (identified.type === "immediate") {
        this.dispatchEvent(identified, filename);
      } else if (identified.type === "one-shot") {
        const at = new Date(identified.at).getTime();
        if (!Number.isFinite(at) || at <= Date.now()) {
          this.markSkipped(filename, identified, "expired_or_invalid_time");
          return;
        }
        const timer = setTimeout(() => {
          this.oneShotTimers.delete(filename);
          this.dispatchEvent(identified, filename);
        }, at - Date.now());
        this.oneShotTimers.set(filename, timer);
        this.knownFiles.add(filename);
      } else if (identified.type === "periodic") {
        const cron = parseCron(identified.schedule);
        this.periodic.set(filename, {
          parsed: cron,
          event: identified,
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

      void this.runLeasedEvent(lock.event, filename, lock.slotKey, lock.runId);
      return;
    }

    const runId = event.status?.runId ?? this.createRunId(filename);
    void this.runLeasedEvent(event, filename, slotKey ?? this.buildTriggerSlot(event, filename), runId);
  }

  private async runLeasedEvent(event: MomEvent, filename: string, triggerSlot: string, runId: string): Promise<void> {
    const settings = this.getExecutionSettings();
    const store = this.getLeaseStore();
    let currentRunId = runId;
    const taskId = event.taskId ?? `${this.getLeaseScope()}:${filename}`;

    if (store.hasActiveForTask(taskId, this.getLeaseScope())) {
      store.recordSkipped({
        leaseScope: this.getLeaseScope(),
        eventFile: filename,
        eventType: event.type,
        triggerSlot,
        chatId: event.chatId,
        sessionId: event.chatId,
        channel: this.options.channel,
        taskId,
        runId: currentRunId,
        maxAttempts: settings.maxAttempts,
        timeoutMs: settings.executionTimeoutMs,
        eventPayloadJson: JSON.stringify(event),
        reason: "task_already_running"
      });
      // Periodic dispatch already flipped the event file to "running" via the
      // run-lock. Since we are skipping this run, release that lock so the file
      // does not stay stuck in "running" forever.
      this.releasePeriodicRunLock(filename, event, "task_already_running", triggerSlot, currentRunId);
      return;
    }

    while (true) {
      const lease = store.acquire({
        leaseScope: this.getLeaseScope(),
        eventFile: filename,
        eventType: event.type,
        triggerSlot,
        chatId: event.chatId,
        sessionId: event.chatId,
        channel: this.options.channel,
        taskId,
        runId: currentRunId,
        maxAttempts: settings.maxAttempts,
        timeoutMs: settings.executionTimeoutMs,
        eventPayloadJson: JSON.stringify(event)
      });
      if (!lease) return;

      const eventForAttempt = this.withRunStatus(event, currentRunId, triggerSlot);
      this.markRunning(filename, eventForAttempt, triggerSlot, currentRunId);
      const outcome = await this.runAttemptWithTimeout(eventForAttempt, filename, lease);
      if (outcome.status === "success") {
        if (store.markCompleted(lease.id, lease.runId)) {
          this.markDone(filename, eventForAttempt, "executed", triggerSlot, currentRunId);
        }
        return;
      }

      if (outcome.status === "error") {
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        if (store.markFailed(lease.id, lease.runId, message)) {
          this.markError(filename, message, triggerSlot, currentRunId);
        }
        return;
      }

      const timedOut = store.markTimedOut(lease.id, lease.runId, settings.retryDelayMs);
      this.markTimeout(filename, eventForAttempt, timedOut, triggerSlot, currentRunId);
      if (!timedOut || timedOut.status !== "retry_wait") return;
      await sleep(settings.retryDelayMs);
      currentRunId = this.createRunId(filename);
    }
  }

  private async runAttemptWithTimeout(
    event: MomEvent,
    filename: string,
    lease: EventExecutionLease
  ): Promise<{ status: "success" } | { status: "timeout" } | { status: "error"; error: unknown }> {
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;
    const runPromise = Promise.resolve()
      .then(() => this.onEvent(event, filename))
      .then(() => ({ status: "success" as const }))
      .catch((error) => ({ status: "error" as const, error }));

    const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
      timeout = setTimeout(() => {
        if (settled) return;
        void Promise.resolve(this.options.onTimeout?.({ event, filename, runId: lease.runId, lease }))
          .catch(() => undefined)
          .finally(() => {
            resolve({ status: "timeout" });
          });
      }, lease.timeoutMs);
    });

    const result = await Promise.race([runPromise, timeoutPromise]);
    settled = true;
    if (timeout) clearTimeout(timeout);

    if (result.status === "timeout") {
      // The timeout fired first, but the run may still complete. Await it so
      // we can suppress duplicate retries when the run actually succeeded, or
      // surface a more specific error when it failed after the timeout.
      const finalResult = await runPromise;
      if (finalResult.status === "success" || finalResult.status === "error") {
        return finalResult;
      }
    }
    return result;
  }

  private resumeRecoveredLease(filename: string, event: MomEvent): boolean {
    if (event.status?.state !== "running") return false;
    const triggerSlot = event.status.runningSlotKey ?? this.buildTriggerSlot(event, filename);
    const lease = this.getLeaseStore().getLatest(this.getLeaseScope(), filename, event.chatId, triggerSlot);
    if (!lease) return false;

    if (lease.status === "retry_wait") {
      void this.runLeasedEvent(event, filename, triggerSlot, this.createRunId(filename));
      return true;
    }

    if (lease.status === "failed") {
      this.markTimeout(filename, event, lease, triggerSlot, lease.runId);
      return true;
    }

    if (lease.status === "aborted") {
      this.markError(filename, lease.lastError ?? "Event attempt was stopped.", triggerSlot, lease.runId);
      return true;
    }

    if (lease.status === "completed") {
      this.markDone(filename, event, "executed", triggerSlot, lease.runId);
      return true;
    }

    return false;
  }

  private buildTriggerSlot(event: MomEvent, filename: string): string {
    if (event.type === "periodic") return event.status?.runningSlotKey ?? this.buildMinuteSlotKey(new Date());
    if (event.type === "one-shot") return `one-shot:${event.at}`;
    return `immediate:${filename}`;
  }

  private withRunStatus(event: MomEvent, runId: string, triggerSlot: string): MomEvent {
    return {
      ...event,
      status: {
        ...(event.status ?? {}),
        state: "running",
        startedAt: new Date().toISOString(),
        runId,
        runningSlotKey: triggerSlot
      }
    };
  }

  private tryAcquirePeriodicRunLock(
    filename: string,
    slotKey: string
  ): { event: MomEvent; slotKey: string; runId: string } | null {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const runId = this.createRunId(filename);
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

  private ensureTaskId(event: MomEvent): MomEvent {
    const raw = String(event.taskId ?? "").trim();
    if (raw) return { ...event, taskId: raw };
    return { ...event, taskId: createEventTaskId() };
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

  private markRunning(filename: string, event: MomEvent, slotKey: string, runId: string): void {
    const next = this.updateEventFile(filename, (current) => ({
      ...current,
      delivery: this.resolveDeliveryMode(current),
      status: {
        ...this.normalizeStatus(current.status),
        state: "running",
        completedAt: undefined,
        reason: "running",
        lastError: undefined,
        startedAt: event.status?.startedAt ?? new Date().toISOString(),
        runId,
        runningSlotKey: slotKey
      }
    }));
    if (next && next.type === "periodic") {
      this.refreshPeriodicEntry(filename, next);
    }
  }

  // Release the "running" run-lock a periodic dispatch placed on the event file
  // when the run is skipped before it ever executes (e.g. task_already_running).
  // Marks this slot as consumed so the same minute is not re-dispatched, without
  // bumping runCount. No-op for non-periodic events (their file is not pre-locked).
  private releasePeriodicRunLock(
    filename: string,
    event: MomEvent,
    reason: string,
    slotKey: string,
    runId: string
  ): void {
    if (event.type !== "periodic") return;
    const next = this.updateEventFile(filename, (current) => {
      if (current.type !== "periodic") return null;
      const status = this.normalizeStatus(current.status);
      if (status.runId && runId && status.runId !== runId) return null;
      return {
        ...current,
        delivery: this.resolveDeliveryMode(current),
        status: {
          ...status,
          state: "pending",
          reason,
          completedAt: undefined,
          lastError: undefined,
          lastSlotKey: slotKey ?? status.runningSlotKey ?? status.lastSlotKey,
          runningSlotKey: undefined,
          startedAt: undefined,
          runId: undefined
        }
      };
    });
    if (next) this.refreshPeriodicEntry(filename, next);
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

  private markTimeout(
    filename: string,
    event: MomEvent,
    lease: EventExecutionLease | null,
    slotKey?: string,
    runId?: string
  ): void {
    const state = lease?.status === "retry_wait" ? "running" : "error";
    const message = lease?.lastError ?? "Event attempt timed out.";
    const next = this.updateEventFile(filename, (current) => {
      const status = this.normalizeStatus(current.status);
      if (runId && status.runId && status.runId !== runId) return null;
      return {
        ...current,
        delivery: this.resolveDeliveryMode(current),
        status: {
          ...status,
          state,
          completedAt: state === "error" ? new Date().toISOString() : status.completedAt,
          runCount: status.runCount ?? event.status?.runCount ?? 0,
          reason: lease?.status === "retry_wait" ? "timeout_retry_wait" : "timeout",
          lastError: message,
          lastSlotKey: state === "error" ? (slotKey ?? status.runningSlotKey ?? status.lastSlotKey) : status.lastSlotKey,
          runningSlotKey: state === "error" ? undefined : (slotKey ?? status.runningSlotKey),
          startedAt: state === "error" ? undefined : status.startedAt,
          runId: state === "error" ? undefined : runId
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

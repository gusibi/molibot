import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createRuntimeTaskId, type MomEvent } from "$lib/server/agent/events.js";

const createSchema = Type.Object({
  action: Type.Literal("create"),
  type: Type.Union([Type.Literal("todo"), Type.Literal("one-shot"), Type.Literal("periodic")]),
  text: Type.String({ description: "Reminder text or recurring Agent instruction." }),
  name: Type.Optional(Type.String({ description: "Optional readable name used in the task id." })),
  at: Type.Optional(Type.String({ description: "Future ISO 8601 datetime with timezone offset. Required for one-shot." })),
  schedule: Type.Optional(Type.String({ description: "Five-field cron expression. Required for periodic." })),
  timezone: Type.Optional(Type.String({ description: "IANA timezone. Required for periodic." })),
  delivery: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("agent")])),
  sessionMode: Type.Optional(Type.Union([Type.Literal("fresh"), Type.Literal("chat")]))
});

const taskPatchSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  text: Type.Optional(Type.String()),
  at: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  delivery: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("agent")])),
  sessionMode: Type.Optional(Type.Union([Type.Literal("fresh"), Type.Literal("chat")]))
});

const runtimeTaskSchema = Type.Union([
  createSchema,
  Type.Object({ action: Type.Literal("list"), type: Type.Optional(Type.Union([Type.Literal("todo"), Type.Literal("one-shot"), Type.Literal("periodic")])) }),
  Type.Object({ action: Type.Literal("get"), taskId: Type.String() }),
  Type.Object({ action: Type.Literal("update"), taskId: Type.String(), patch: taskPatchSchema }),
  Type.Object({ action: Type.Literal("delete"), taskId: Type.String() })
]);

type UserRuntimeTask = Extract<MomEvent, { type: "todo" | "one-shot" | "periodic" }>;

interface TaskFile {
  filename: string;
  path: string;
  mtimeMs: number;
  event: UserRuntimeTask;
}

function isUserRuntimeTask(value: MomEvent): value is UserRuntimeTask {
  return (value.type === "todo" || value.type === "one-shot" || value.type === "periodic") && value.managed?.by !== "molibot";
}

function readTaskFiles(eventsDir: string): TaskFile[] {
  let filenames: string[];
  try {
    filenames = readdirSync(eventsDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return filenames.flatMap((filename) => {
    const path = join(eventsDir, filename);
    try {
      const event = JSON.parse(readFileSync(path, "utf8")) as MomEvent;
      if (!isUserRuntimeTask(event)) return [];
      return [{ filename, path, mtimeMs: statSync(path).mtimeMs, event }];
    } catch {
      return [];
    }
  });
}

function findTask(eventsDir: string, taskId: string): TaskFile {
  const normalized = taskId.trim();
  const matches = readTaskFiles(eventsDir).filter((row) => String(row.event.taskId ?? "").trim() === normalized);
  if (matches.length === 0) throw new Error(`Runtime Task not found: ${normalized}`);
  if (matches.length > 1) throw new Error(`Duplicate Runtime Task id: ${normalized}`);
  return matches[0];
}

function validateCron(schedule: string): string {
  const normalized = schedule.trim();
  if (normalized.split(/\s+/).length !== 5) throw new Error("schedule must be a five-field cron expression.");
  return normalized;
}

function validateFutureAt(at: string): string {
  const timestamp = new Date(at).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("at must be a valid ISO 8601 datetime.");
  if (timestamp <= Date.now()) throw new Error("at must be in the future.");
  return new Date(timestamp).toISOString();
}

function atomicWrite(path: string, event: UserRuntimeTask): void {
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(event, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* nothing to clean */ }
    throw error;
  }
}

export function collectRuntimeTaskIds(eventsDir: string): Set<string> {
  const existing = new Set<string>();
  let filenames: string[] = [];
  try {
    filenames = readdirSync(eventsDir).filter((filename) => filename.endsWith(".json"));
  } catch {
    // The caller creates the directory before allocating an id.
  }
  for (const filename of filenames) {
    try {
      const parsed = JSON.parse(readFileSync(join(eventsDir, filename), "utf8")) as { taskId?: unknown };
      const taskId = String(parsed.taskId ?? "").trim();
      if (taskId) existing.add(taskId);
    } catch {
      // Malformed events are diagnosed by the watcher; they cannot contribute a usable id.
    }
  }
  return existing;
}

function newTaskId(eventsDir: string, name?: string): string {
  const existing = collectRuntimeTaskIds(eventsDir);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const taskId = createRuntimeTaskId(name);
    if (!existing.has(taskId)) return taskId;
  }
  throw new Error("Unable to allocate a unique Runtime Task id.");
}

function publicTask(row: TaskFile) {
  const event = row.event;
  return {
    taskId: event.taskId,
    type: event.type,
    enabled: event.enabled !== false,
    text: event.text,
    ...(event.type === "todo" ? {} : {
      delivery: event.delivery ?? (event.type === "periodic" ? "agent" : "text"),
      sessionMode: event.sessionMode ?? (event.type === "periodic" ? "fresh" : "chat")
    }),
    ...(event.type === "one-shot" ? { at: event.at } : event.type === "periodic" ? { schedule: event.schedule, timezone: event.timezone } : {}),
    status: event.status?.state ?? "pending",
    lastTriggeredAt: event.status?.lastTriggeredAt,
    completedAt: event.status?.completedAt,
    lastError: event.status?.lastError,
    updatedAt: new Date(row.mtimeMs).toISOString()
  };
}

export function createRuntimeTaskTool(options: {
  workspaceDir: string;
  chatId: string;
  sessionId?: string;
  timezone: string;
}): AgentTool<typeof runtimeTaskSchema> {
  const eventsDir = resolve(options.workspaceDir, "events");
  return {
    name: "runtimeTask",
    label: "runtimeTask",
    description: [
      "Create, list, inspect, update, and delete Agent Runtime tasks.",
      "A todo is an unscheduled item, a one-shot Runtime Task is a reminder, and a periodic Runtime Task is an automation.",
      "Runtime Events are execution records and notifications are delivery outcomes; neither is a separate user CRUD resource.",
      "This tool never reads or writes Mini App Todo data. Mini Apps own their own optional data and business rules.",
      "Use action=create for reminders and automations; list/get before changing an ambiguous task; update by taskId; delete only when the user asked to remove it.",
      "Never use memory, shell sleeps, OS schedulers, or manually edited event JSON files for scheduling."
    ].join("\n"),
    parameters: runtimeTaskSchema,
    execute: async (_toolCallId, params) => {
      mkdirSync(eventsDir, { recursive: true });

      if (params.action === "list") {
        const tasks = readTaskFiles(eventsDir)
          .filter((row) => !params.type || row.event.type === params.type)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .map(publicTask);
        return toolResult({ tasks, count: tasks.length });
      }

      if (params.action === "get") {
        return toolResult({ task: publicTask(findTask(eventsDir, params.taskId)) });
      }

      if (params.action === "delete") {
        const row = findTask(eventsDir, params.taskId);
        unlinkSync(row.path);
        return toolResult({ deleted: true, taskId: params.taskId });
      }

      if (params.action === "update") {
        const row = findTask(eventsDir, params.taskId);
        const patch = params.patch;
        const next: UserRuntimeTask = { ...row.event };
        if (patch.enabled !== undefined) next.enabled = patch.enabled;
        if (patch.text !== undefined) {
          const text = patch.text.trim();
          if (!text) throw new Error("text cannot be empty.");
          next.text = text;
        }
        if (patch.delivery !== undefined) next.delivery = patch.delivery;
        if (patch.sessionMode !== undefined) next.sessionMode = patch.sessionMode;
        if (next.type === "todo") {
          if (patch.at !== undefined || patch.schedule !== undefined || patch.timezone !== undefined || patch.delivery !== undefined || patch.sessionMode !== undefined) {
            throw new Error("todo tasks do not accept schedule or delivery fields.");
          }
        } else if (next.type === "one-shot") {
          if (patch.schedule !== undefined || patch.timezone !== undefined) throw new Error("schedule/timezone only apply to periodic tasks.");
          if (patch.at !== undefined) {
            next.at = validateFutureAt(patch.at);
            next.status = { ...next.status, state: "pending", completedAt: undefined, reason: "rescheduled", lastError: undefined, reminderUnread: false };
          }
        } else {
          if (patch.at !== undefined) throw new Error("at only applies to one-shot tasks.");
          if (patch.schedule !== undefined) next.schedule = validateCron(patch.schedule);
          if (patch.timezone !== undefined) {
            const timezone = patch.timezone.trim();
            if (!timezone) throw new Error("timezone cannot be empty.");
            next.timezone = timezone;
          }
          next.status = { ...next.status, state: "pending", completedAt: undefined, reason: "updated", lastError: undefined };
        }
        atomicWrite(row.path, next);
        return toolResult({ updated: true, task: publicTask({ ...row, mtimeMs: Date.now(), event: next }) });
      }

      const text = params.text.trim();
      if (!text) throw new Error("text cannot be empty.");
      const taskId = newTaskId(eventsDir, params.name);
      const common = {
        taskId,
        enabled: true,
        chatId: options.chatId,
        sessionId: options.sessionId,
        text,
        status: { state: "pending" as const, runCount: 0 }
      };
      const event: UserRuntimeTask = params.type === "todo"
        ? {
            ...common,
            type: "todo"
          }
        : params.type === "one-shot"
        ? {
            ...common,
            type: "one-shot",
            at: validateFutureAt(String(params.at ?? "")),
            delivery: params.delivery ?? "text",
            sessionMode: params.sessionMode ?? "chat"
          }
        : {
            ...common,
            type: "periodic",
            schedule: validateCron(String(params.schedule ?? "")),
            timezone: String(params.timezone ?? options.timezone).trim() || options.timezone,
            delivery: params.delivery ?? "agent",
            sessionMode: params.sessionMode ?? "fresh"
          };
      const path = join(eventsDir, `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      atomicWrite(path, event);
      return toolResult({ created: true, task: publicTask({ filename: path.split("/").pop() ?? "", path, mtimeMs: Date.now(), event }) });
    }
  };
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: undefined
  };
}

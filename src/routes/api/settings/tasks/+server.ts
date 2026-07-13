import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import { createEventTaskId, type MomEvent } from "$lib/server/agent/events";
import { getEventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore";
import { SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_CHANNEL, TASK_CHANNEL_ROOTS, type TaskChannel } from "$lib/server/agent/commands/taskChannels";
import { buildDesktopTaskTargets } from "$lib/server/app/desktopTasks";
import { dispatchTaskEvent } from "$lib/server/agent/taskScheduler";

type TaskScope = "workspace" | "chat-scratch";
type TaskType = "one-shot" | "periodic" | "immediate";
type TaskState = "pending" | "running" | "completed" | "skipped" | "error";
type TaskSource = TaskChannel | typeof SYSTEM_TASK_CHANNEL;
const INTERNAL_TASK_TARGET_DIRS = new Set([
  "attachments",
  "contexts",
  "events",
  "run-details",
  "scratch",
  "skill-drafts",
  "skills"
]);

interface EventStatus {
  state?: TaskState;
  completedAt?: string;
  lastTriggeredAt?: string;
  runCount?: number;
  reason?: string;
  lastError?: string;
}

interface RawEventTask {
  taskId?: string;
  managed?: { by?: string; scope?: string; kind?: string; ownerId?: string };
  enabled?: boolean;
  execution?: string;
  internal?: { kind?: string };
  type: TaskType;
  chatId?: string;
  text?: string;
  delivery?: string;
  at?: string;
  schedule?: string;
  timezone?: string;
  sessionMode?: string;
  status?: EventStatus;
}

interface TaskItem {
  channel: TaskSource;
  taskId: string;
  managed?: RawEventTask["managed"];
  botId: string;
  chatId: string;
  scope: TaskScope;
  filename: string;
  filePath: string;
  type: TaskType;
  enabled: boolean;
  delivery: string;
  text: string;
  scheduleText: string;
  timezone: string;
  status: TaskState;
  statusReason: string;
  lastError: string;
  runCount: number;
  completedAt: string;
  lastTriggeredAt: string;
  sessionMode: string;
  updatedAt: string;
  createdAt: string;
}

interface TaskDeleteBody {
  action?: "delete";
  filePaths?: string[];
}

interface TaskTriggerBody {
  action?: "trigger";
  filePaths?: string[];
}

interface TaskUpdatePatch {
  enabled?: boolean;
  text?: string;
  delivery?: string;
  at?: string;
  schedule?: string;
  timezone?: string;
  sessionMode?: string;
}

interface TaskUpdateBody {
  action?: "update";
  filePath?: string;
  patch?: TaskUpdatePatch;
}

interface TaskCreateBody {
  action?: "create";
  task?: {
    channel?: string;
    botId?: string;
    chatId?: string;
    scope?: TaskScope;
    text?: string;
    delivery?: string;
    schedule?: string;
    timezone?: string;
    sessionMode?: string;
  };
}

function inferCreatedAt(filename: string, fallbackIso: string): string {
  const match = filename.match(/-(\d{10,})\.json$/);
  if (!match) return fallbackIso;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return fallbackIso;
  return new Date(value).toISOString();
}

function toTaskItem(
  raw: RawEventTask,
  channel: TaskSource,
  botId: string,
  fallbackChatId: string,
  scope: TaskScope,
  filePath: string,
): TaskItem | null {
  if (raw.type !== "one-shot" && raw.type !== "periodic" && raw.type !== "immediate") {
    return null;
  }

  const stat = statSync(filePath);
  const updatedAt = stat.mtime.toISOString();
  const filename = filePath.split("/").at(-1) ?? filePath;
  const chatId = String(raw.chatId ?? fallbackChatId ?? "").trim();
  const type = raw.type;
  const status = raw.status?.state ?? "pending";

  let scheduleText = "Immediate";
  if (type === "one-shot") scheduleText = String(raw.at ?? "").trim();
  if (type === "periodic") scheduleText = String(raw.schedule ?? "").trim();

  return {
    channel,
    taskId: String(raw.taskId ?? "").trim(),
    managed: raw.managed,
    botId,
    chatId,
    scope,
    filename,
    filePath,
    type,
    enabled: raw.enabled !== false,
    delivery: String(raw.delivery ?? "agent").trim() || "agent",
    text: String(raw.text ?? "").trim(),
    scheduleText,
    timezone: String(raw.timezone ?? "").trim(),
    sessionMode: String(raw.sessionMode ?? "").trim(),
    status,
    statusReason: String(raw.status?.reason ?? "").trim(),
    lastError: String(raw.status?.lastError ?? "").trim(),
    runCount: Number(raw.status?.runCount ?? 0),
    completedAt: String(raw.status?.completedAt ?? "").trim(),
    lastTriggeredAt: String(raw.status?.lastTriggeredAt ?? "").trim(),
    updatedAt,
    createdAt: inferCreatedAt(filename, updatedAt)
  };
}

function readTaskFile(
  filePath: string,
  channel: TaskSource,
  botId: string,
  fallbackChatId: string,
  scope: TaskScope,
  diagnostics: string[],
): TaskItem | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as RawEventTask;
    if (parsed && typeof parsed === "object" && parsed.type === "periodic" && !String(parsed.taskId ?? "").trim()) {
      parsed.taskId = createEventTaskId();
      writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    }
    return toTaskItem(parsed, channel, botId, fallbackChatId, scope, filePath);
  } catch (error) {
    diagnostics.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function resolveTasksRoots(): Array<{ channel: TaskSource; botsRoot: string }> {
  const dataRoot = resolve(config.dataDir);
  return [...TASK_CHANNEL_ROOTS.map(({ channel, dir }) => ({
    channel,
    botsRoot: channel === "web"
      ? join(resolve(config.webWorkspaceDir), "bots")
      : join(dataRoot, dir, "bots")
  })), { channel: SYSTEM_TASK_CHANNEL, botsRoot: join(dataRoot, SYSTEM_TASK_BOTS_DIR) }];
}

function isTaskFilePath(filePath: string, botsRoots: Array<{ channel: TaskSource; botsRoot: string }>): boolean {
  const resolved = resolve(filePath);
  const matchedRoot = botsRoots.find(({ botsRoot }) => resolved.startsWith(`${botsRoot}/`));
  if (!matchedRoot || !resolved.endsWith(".json")) return false;
  return (
    resolved.includes("/events/") ||
    resolved.includes("/scratch/events/")
  );
}

function inferTaskContextFromPath(filePath: string, botsRoots: Array<{ channel: TaskSource; botsRoot: string }>): {
  channel: TaskSource;
  botId: string;
  chatId: string;
  scope: TaskScope;
} | null {
  const resolvedPath = resolve(filePath);
  const root = botsRoots.find(({ botsRoot }) => resolvedPath.startsWith(`${botsRoot}/`));
  if (!root) return null;
  const relative = resolvedPath.slice(`${root.botsRoot}/`.length);
  const parts = relative.split("/");
  const botId = parts[0] ?? "";
  if (!botId) return null;

  if (parts[1] === "events") {
    return { channel: root.channel, botId, chatId: "", scope: "workspace" };
  }
  if (parts[2] === "scratch" && parts[3] === "events") {
    return { channel: root.channel, botId, chatId: parts[1] ?? "", scope: "chat-scratch" };
  }
  return null;
}

export const GET: RequestHandler = async () => {
  const dataRoot = resolve(config.dataDir);
  const taskRoots = resolveTasksRoots();
  const diagnostics: string[] = [];
  const items: TaskItem[] = [];

  for (const { channel, botsRoot } of taskRoots) {
    if (!existsSync(botsRoot)) continue;

    const botEntries = readdirSync(botsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const botEntry of botEntries) {
      const botId = botEntry.name;
      const botDir = join(botsRoot, botId);
      for (const filePath of collectJsonFiles(join(botDir, "events"))) {
        const item = readTaskFile(filePath, channel, botId, "", "workspace", diagnostics);
        if (item) items.push(item);
      }

      const chatEntries = readdirSync(botDir, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && !INTERNAL_TASK_TARGET_DIRS.has(entry.name)
      );
      for (const chatEntry of chatEntries) {
        const chatId = chatEntry.name;
        for (const filePath of collectJsonFiles(join(botDir, chatId, "scratch", "events"))) {
          const item = readTaskFile(filePath, channel, botId, chatId, "chat-scratch", diagnostics);
          if (item) items.push(item);
        }
      }
    }
  }

  items.sort((a, b) => {
    const typeOrder = ["one-shot", "periodic", "immediate"];
    const typeDiff = typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const targets = buildDesktopTaskTargets(getRuntime().getSettings());

  const countsByType = {
    "one-shot": items.filter((item) => item.type === "one-shot").length,
    periodic: items.filter((item) => item.type === "periodic").length,
    immediate: items.filter((item) => item.type === "immediate").length
  };
  const countsByStatus = {
    pending: items.filter((item) => item.status === "pending").length,
    running: items.filter((item) => item.status === "running").length,
    completed: items.filter((item) => item.status === "completed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    error: items.filter((item) => item.status === "error").length
  };
  const countsByScope = {
    workspace: items.filter((item) => item.scope === "workspace").length,
    chatScratch: items.filter((item) => item.scope === "chat-scratch").length
  };
  const countsByChannel: Record<TaskSource, number> = {
    web: items.filter((item) => item.channel === "web").length,
    telegram: items.filter((item) => item.channel === "telegram").length,
    feishu: items.filter((item) => item.channel === "feishu").length,
    qq: items.filter((item) => item.channel === "qq").length,
    weixin: items.filter((item) => item.channel === "weixin").length,
    system: items.filter((item) => item.channel === "system").length
  };

  return json({
    ok: true,
    dataRoot,
    items,
    targets,
    counts: {
      total: items.length,
      byType: countsByType,
      byStatus: countsByStatus,
      byScope: countsByScope,
      byChannel: countsByChannel
    },
    diagnostics
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: TaskDeleteBody | TaskTriggerBody | TaskUpdateBody | TaskCreateBody;
  try {
    body = (await request.json()) as TaskDeleteBody | TaskTriggerBody | TaskUpdateBody | TaskCreateBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "create") {
    const task = body.task && typeof body.task === "object" ? body.task : null;
    if (!task) return json({ ok: false, error: "task is required" }, { status: 400 });
    const channel = String(task.channel ?? "").trim() as TaskChannel;
    const botId = String(task.botId ?? "").trim();
    const chatId = String(task.chatId ?? "").trim();
    const scope = task.scope === "chat-scratch" ? "chat-scratch" : "workspace";
    const text = String(task.text ?? "").trim();
    const delivery = String(task.delivery ?? "agent").trim().toLowerCase();
    const schedule = String(task.schedule ?? "").trim();
    const timezone = String(task.timezone ?? "").trim();
    const sessionMode = String(task.sessionMode ?? "fresh").trim().toLowerCase();
    if (!text) return json({ ok: false, error: "task text is required" }, { status: 400 });
    if (delivery !== "agent" && delivery !== "text") return json({ ok: false, error: "delivery must be text or agent" }, { status: 400 });
    if (schedule.split(/\s+/).filter(Boolean).length !== 5) return json({ ok: false, error: "schedule must be a 5-field cron expression" }, { status: 400 });
    if (!timezone) return json({ ok: false, error: "timezone is required" }, { status: 400 });
    if (sessionMode !== "fresh" && sessionMode !== "chat") return json({ ok: false, error: "sessionMode must be fresh or chat" }, { status: 400 });

    const root = resolveTasksRoots().find((entry) => entry.channel === channel);
    if (!root || !botId || botId.includes("/") || botId.includes("..")) return json({ ok: false, error: "invalid task target" }, { status: 400 });
    const botDir = join(root.botsRoot, botId);
    if (!existsSync(botDir)) return json({ ok: false, error: "bot_not_found" }, { status: 404 });
    if (scope === "chat-scratch") {
      if (!chatId || chatId.includes("/") || chatId.includes("..")) {
        return json({ ok: false, error: "chat_not_found" }, { status: 404 });
      }
      const chatDir = join(botDir, chatId);
      if (!existsSync(chatDir)) {
        if (channel === "web") {
          mkdirSync(chatDir, { recursive: true });
        } else {
          return json({ ok: false, error: "chat_not_found" }, { status: 404 });
        }
      }
    }
    const eventsDir = scope === "workspace" ? join(botDir, "events") : join(botDir, chatId, "scratch", "events");
    mkdirSync(eventsDir, { recursive: true });
    const now = Date.now();
    const filePath = join(eventsDir, `periodic-${now}-${Math.random().toString(36).slice(2, 8)}.json`);
    const event: RawEventTask = {
      taskId: createEventTaskId(),
      enabled: true,
      type: "periodic",
      ...(chatId ? { chatId } : {}),
      text,
      delivery,
      schedule,
      timezone,
      sessionMode,
      status: { state: "pending", runCount: 0 }
    };
    writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return json({ ok: true, created: filePath });
  }

  if (body.action === "update") {
    const filePath = String(body.filePath ?? "").trim();
    if (!filePath) {
      return json({ ok: false, error: "filePath is required for update" }, { status: 400 });
    }
    const patch = body.patch && typeof body.patch === "object" ? body.patch : null;
    if (!patch) {
      return json({ ok: false, error: "patch is required for update" }, { status: 400 });
    }

    const taskRoots = resolveTasksRoots();
    const resolvedPath = resolve(filePath);
    if (!isTaskFilePath(resolvedPath, taskRoots)) {
      return json({ ok: false, error: "path_not_allowed" }, { status: 400 });
    }
    if (!existsSync(resolvedPath)) {
      return json({ ok: false, error: "not_found" }, { status: 404 });
    }

    let current: RawEventTask;
    try {
      current = JSON.parse(readFileSync(resolvedPath, "utf8")) as RawEventTask;
    } catch (error) {
      return json({
        ok: false,
        error: `invalid_task_payload: ${error instanceof Error ? error.message : String(error)}`
      }, { status: 400 });
    }
    if (current.managed?.by === "molibot") {
      return json({ ok: false, error: "system_task_managed" }, { status: 400 });
    }

    if (current.type !== "one-shot" && current.type !== "periodic" && current.type !== "immediate") {
      return json({ ok: false, error: "unsupported_task_type" }, { status: 400 });
    }

    const next: RawEventTask = { ...current };

    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") {
        return json({ ok: false, error: "enabled must be boolean" }, { status: 400 });
      }
      next.enabled = patch.enabled;
    }

    if (patch.text !== undefined) {
      next.text = String(patch.text ?? "").trim();
      if (!next.text) {
        return json({ ok: false, error: "text cannot be empty" }, { status: 400 });
      }
    }

    if (patch.delivery !== undefined) {
      const normalizedDelivery = String(patch.delivery ?? "").trim().toLowerCase();
      if (normalizedDelivery !== "text" && normalizedDelivery !== "agent") {
        return json({ ok: false, error: "delivery must be text or agent" }, { status: 400 });
      }
      next.delivery = normalizedDelivery;
    }

    if (current.type === "one-shot") {
      if (patch.at !== undefined) {
        const at = String(patch.at ?? "").trim();
        const dt = new Date(at);
        if (!at || Number.isNaN(dt.getTime())) {
          return json({ ok: false, error: "at must be a valid ISO datetime" }, { status: 400 });
        }
        next.at = at;
      }
    }

    if (current.type === "periodic") {
      if (patch.schedule !== undefined) {
        const schedule = String(patch.schedule ?? "").trim();
        const parts = schedule.split(/\s+/).filter(Boolean);
        if (parts.length !== 5) {
          return json({ ok: false, error: "schedule must be a 5-field cron expression" }, { status: 400 });
        }
        next.schedule = schedule;
      }
      if (patch.timezone !== undefined) {
        const timezone = String(patch.timezone ?? "").trim();
        if (!timezone) {
          return json({ ok: false, error: "timezone cannot be empty for periodic task" }, { status: 400 });
        }
        next.timezone = timezone;
      }
    }

    if (patch.sessionMode !== undefined) {
      const sm = String(patch.sessionMode ?? "").trim().toLowerCase();
      if (sm !== "" && sm !== "fresh" && sm !== "chat") {
        return json({ ok: false, error: "sessionMode must be fresh or chat" }, { status: 400 });
      }
      if (sm === "") {
        delete next.sessionMode;
      } else {
        next.sessionMode = sm;
      }
    }

    if (!next.text?.trim()) {
      return json({ ok: false, error: "task text is required" }, { status: 400 });
    }
    if ((next.type === "one-shot") && !String(next.at ?? "").trim()) {
      return json({ ok: false, error: "one-shot task requires at" }, { status: 400 });
    }
    if ((next.type === "periodic") && !String(next.schedule ?? "").trim()) {
      return json({ ok: false, error: "periodic task requires schedule" }, { status: 400 });
    }
    if ((next.type === "periodic") && !String(next.timezone ?? "").trim()) {
      return json({ ok: false, error: "periodic task requires timezone" }, { status: 400 });
    }

    writeFileSync(resolvedPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return json({
      ok: true,
      updated: resolvedPath
    });
  }

  const requestedPaths = Array.isArray((body as TaskDeleteBody | TaskTriggerBody).filePaths)
    ? (body as TaskDeleteBody | TaskTriggerBody).filePaths!.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (requestedPaths.length === 0) {
    return json({ ok: false, error: "filePaths is required" }, { status: 400 });
  }

  const taskRoots = resolveTasksRoots();

  if (body.action === "delete") {
    const deleted: string[] = [];
    const failed: Array<{ filePath: string; reason: string }> = [];

    for (const filePath of requestedPaths) {
      const resolvedPath = resolve(filePath);
      if (!isTaskFilePath(resolvedPath, taskRoots)) {
        failed.push({ filePath: resolvedPath, reason: "path_not_allowed" });
        continue;
      }
      if (!existsSync(resolvedPath)) {
        failed.push({ filePath: resolvedPath, reason: "not_found" });
        continue;
      }

      try {
        const current = JSON.parse(readFileSync(resolvedPath, "utf8")) as RawEventTask;
        if (current.managed?.by === "molibot") {
          failed.push({ filePath: resolvedPath, reason: "system_task_managed" });
          continue;
        }
        unlinkSync(resolvedPath);
        deleted.push(resolvedPath);
      } catch (error) {
        failed.push({
          filePath: resolvedPath,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return json({
      ok: failed.length === 0,
      deleted,
      failed,
      requested: requestedPaths.length
    }, { status: failed.length > 0 ? 207 : 200 });
  }

  if (body.action === "trigger") {
    const runtime = getRuntime();
    const triggered: string[] = [];
    const failed: Array<{ filePath: string; reason: string }> = [];

    for (const filePath of requestedPaths) {
      const resolvedPath = resolve(filePath);
      if (!isTaskFilePath(resolvedPath, taskRoots)) {
        failed.push({ filePath: resolvedPath, reason: "path_not_allowed" });
        continue;
      }
      if (!existsSync(resolvedPath)) {
        failed.push({ filePath: resolvedPath, reason: "not_found" });
        continue;
      }

      try {
        const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as RawEventTask;
        const context = inferTaskContextFromPath(resolvedPath, taskRoots);
        if (!context) {
          failed.push({ filePath: resolvedPath, reason: "invalid_task_path" });
          continue;
        }

        const item = toTaskItem(parsed, context.channel, context.botId, context.chatId, context.scope, resolvedPath);
        if (!item) {
          failed.push({ filePath: resolvedPath, reason: "invalid_task_payload" });
          continue;
        }
        if (parsed.enabled === false) {
          failed.push({ filePath: resolvedPath, reason: "task_paused" });
          continue;
        }

        const isOwnerInternal = item.channel === SYSTEM_TASK_CHANNEL && parsed.execution === "internal";
        const manager = isOwnerInternal ? undefined : runtime.channelManagers.get(item.channel)?.get(item.botId);
        if (!isOwnerInternal && !manager) {
          failed.push({ filePath: resolvedPath, reason: `${item.channel}_manager_not_found:${item.botId}` });
          continue;
        }
        if (!isOwnerInternal && typeof manager?.triggerTask !== "function") {
          failed.push({ filePath: resolvedPath, reason: `${item.channel}_trigger_not_supported` });
          continue;
        }
        const dispatch = async (eventForRun: MomEvent): Promise<void> => {
          if (isOwnerInternal) {
            await runtime.runInternalEvent(eventForRun, item.filename);
          } else if (eventForRun.execution === "internal") {
            await dispatchTaskEvent(eventForRun, item.filename, manager!, runtime.runInternalEvent);
          } else {
            await manager!.triggerTask!(eventForRun, item.filename);
          }
        };

        if (parsed.type === "periodic") {
          const taskId = String(parsed.taskId ?? item.taskId ?? "").trim() || createEventTaskId();
          parsed.taskId = taskId;
          writeFileSync(resolvedPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
          const leaseScope = `${item.channel}:${item.botId}`;
          const triggerSlot = `manual:${Date.now()}`;
          const runId = `${item.filename}:${triggerSlot}:${Math.random().toString(36).slice(2, 8)}`;
          const store = getEventExecutionLeaseStore();
          if (store.hasActiveForTask(taskId, leaseScope)) {
            store.recordSkipped({
              leaseScope,
              eventFile: item.filename,
              eventType: parsed.type,
              triggerSlot,
              chatId: item.chatId,
              sessionId: item.chatId,
              channel: item.channel,
              taskId,
              runId,
              maxAttempts: 1,
              timeoutMs: 10 * 60 * 1000,
              eventPayloadJson: JSON.stringify(parsed),
              reason: "task_already_running"
            });
            failed.push({ filePath: resolvedPath, reason: "task_already_running" });
            continue;
          }
          const lease = store.acquire({
            leaseScope,
            eventFile: item.filename,
            eventType: parsed.type,
            triggerSlot,
            chatId: item.chatId,
            sessionId: item.chatId,
            channel: item.channel,
            taskId,
            runId,
            maxAttempts: 1,
            timeoutMs: 10 * 60 * 1000,
            eventPayloadJson: JSON.stringify(parsed)
          });
          if (!lease) {
            failed.push({ filePath: resolvedPath, reason: "task_already_running" });
            continue;
          }
          const eventForRun: MomEvent = {
            ...(parsed as MomEvent),
            taskId,
            status: { state: parsed.status?.state ?? "running", ...(parsed.status ?? {}), runId }
          };
          try {
            await dispatch(eventForRun);
            store.markCompleted(lease.id, runId);
          } catch (error) {
            store.markFailed(lease.id, runId, error instanceof Error ? error.message : String(error));
            throw error;
          }
        } else {
          await dispatch(parsed as MomEvent);
        }
        triggered.push(resolvedPath);
      } catch (error) {
        failed.push({
          filePath: resolvedPath,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return json({
      ok: failed.length === 0,
      triggered,
      failed,
      requested: requestedPaths.length
    }, { status: failed.length > 0 ? 207 : 200 });
  }

  return json({ ok: false, error: "Unsupported action" }, { status: 400 });
};

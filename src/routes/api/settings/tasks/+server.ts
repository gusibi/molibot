import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import type { MomEvent } from "$lib/server/agent/events";
import type { Channel } from "$lib/shared/types/message";

type TaskScope = "workspace" | "chat-scratch";
type TaskType = "one-shot" | "periodic" | "immediate";
type TaskState = "pending" | "running" | "completed" | "skipped" | "error";
type TaskChannel = Extract<Channel, "telegram" | "feishu" | "qq" | "weixin">;

const TASK_CHANNEL_ROOTS: Array<{ channel: TaskChannel; dir: string }> = [
  { channel: "telegram", dir: "moli-t" },
  { channel: "feishu", dir: "moli-f" },
  { channel: "qq", dir: "moli-q" },
  { channel: "weixin", dir: "moli-wx" }
];

interface EventStatus {
  state?: TaskState;
  completedAt?: string;
  lastTriggeredAt?: string;
  runCount?: number;
  reason?: string;
  lastError?: string;
}

interface RawEventTask {
  type: TaskType;
  chatId?: string;
  text?: string;
  delivery?: string;
  at?: string;
  schedule?: string;
  timezone?: string;
  status?: EventStatus;
}

interface TaskItem {
  channel: TaskChannel;
  botId: string;
  chatId: string;
  scope: TaskScope;
  filename: string;
  filePath: string;
  type: TaskType;
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
  text?: string;
  delivery?: string;
  at?: string;
  schedule?: string;
  timezone?: string;
}

interface TaskUpdateBody {
  action?: "update";
  filePath?: string;
  patch?: TaskUpdatePatch;
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
  channel: TaskChannel,
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
    botId,
    chatId,
    scope,
    filename,
    filePath,
    type,
    delivery: String(raw.delivery ?? "agent").trim() || "agent",
    text: String(raw.text ?? "").trim(),
    scheduleText,
    timezone: String(raw.timezone ?? "").trim(),
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
  channel: TaskChannel,
  botId: string,
  fallbackChatId: string,
  scope: TaskScope,
  diagnostics: string[],
): TaskItem | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as RawEventTask;
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

function resolveTasksRoots(): Array<{ channel: TaskChannel; botsRoot: string }> {
  const dataRoot = resolve(config.dataDir);
  return TASK_CHANNEL_ROOTS.map(({ channel, dir }) => ({
    channel,
    botsRoot: join(dataRoot, dir, "bots")
  }));
}

function isTaskFilePath(filePath: string, botsRoots: Array<{ channel: TaskChannel; botsRoot: string }>): boolean {
  const resolved = resolve(filePath);
  const matchedRoot = botsRoots.find(({ botsRoot }) => resolved.startsWith(`${botsRoot}/`));
  if (!matchedRoot || !resolved.endsWith(".json")) return false;
  return (
    resolved.includes("/events/") ||
    resolved.includes("/scratch/events/")
  );
}

function inferTaskContextFromPath(filePath: string, botsRoots: Array<{ channel: TaskChannel; botsRoot: string }>): {
  channel: TaskChannel;
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
        (entry) => entry.isDirectory() && entry.name !== "events" && entry.name !== "skills" && entry.name !== "attachments"
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
  const countsByChannel: Record<TaskChannel, number> = {
    telegram: items.filter((item) => item.channel === "telegram").length,
    feishu: items.filter((item) => item.channel === "feishu").length,
    qq: items.filter((item) => item.channel === "qq").length,
    weixin: items.filter((item) => item.channel === "weixin").length
  };

  return json({
    ok: true,
    dataRoot,
    items,
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
  let body: TaskDeleteBody | TaskTriggerBody | TaskUpdateBody;
  try {
    body = (await request.json()) as TaskDeleteBody | TaskTriggerBody | TaskUpdateBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
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

    if (current.type !== "one-shot" && current.type !== "periodic" && current.type !== "immediate") {
      return json({ ok: false, error: "unsupported_task_type" }, { status: 400 });
    }

    const next: RawEventTask = { ...current };

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

        const channelManagers = runtime.channelManagers.get(item.channel) ?? new Map();
        const manager = channelManagers.get(item.botId);
        if (!manager) {
          failed.push({ filePath: resolvedPath, reason: `${item.channel}_manager_not_found:${item.botId}` });
          continue;
        }
        if (typeof manager.triggerTask !== "function") {
          failed.push({ filePath: resolvedPath, reason: `${item.channel}_trigger_not_supported` });
          continue;
        }

        await manager.triggerTask(parsed as MomEvent, item.filename);
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

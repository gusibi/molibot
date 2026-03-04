import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import type { MomEvent } from "$lib/server/agent/events";
import { TelegramManager } from "$lib/server/channels/telegram/runtime";

type TaskScope = "workspace" | "chat-scratch";
type TaskType = "one-shot" | "periodic" | "immediate";
type TaskState = "pending" | "completed" | "skipped" | "error";

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

function inferCreatedAt(filename: string, fallbackIso: string): string {
  const match = filename.match(/-(\d{10,})\.json$/);
  if (!match) return fallbackIso;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return fallbackIso;
  return new Date(value).toISOString();
}

function toTaskItem(
  raw: RawEventTask,
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
  botId: string,
  fallbackChatId: string,
  scope: TaskScope,
  diagnostics: string[],
): TaskItem | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as RawEventTask;
    return toTaskItem(parsed, botId, fallbackChatId, scope, filePath);
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

function resolveTasksRoot(): string {
  return join(resolve(config.dataDir), "moli-t", "bots");
}

function isTaskFilePath(filePath: string, botsRoot: string): boolean {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(`${botsRoot}/`) || !resolved.endsWith(".json")) return false;
  return (
    resolved.includes("/events/") ||
    resolved.includes("/scratch/events/")
  );
}

function inferTaskContextFromPath(filePath: string, botsRoot: string): {
  botId: string;
  chatId: string;
  scope: TaskScope;
} | null {
  const relative = resolve(filePath).slice(`${botsRoot}/`.length);
  const parts = relative.split("/");
  const botId = parts[0] ?? "";
  if (!botId) return null;

  if (parts[1] === "events") {
    return { botId, chatId: "", scope: "workspace" };
  }
  if (parts[2] === "scratch" && parts[3] === "events") {
    return { botId, chatId: parts[1] ?? "", scope: "chat-scratch" };
  }
  return null;
}

export const GET: RequestHandler = async () => {
  const dataRoot = resolve(config.dataDir);
  const botsRoot = resolveTasksRoot();
  const diagnostics: string[] = [];
  const items: TaskItem[] = [];

  if (existsSync(botsRoot)) {
    const botEntries = readdirSync(botsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const botEntry of botEntries) {
      const botId = botEntry.name;
      const botDir = join(botsRoot, botId);

      for (const filePath of collectJsonFiles(join(botDir, "events"))) {
        const item = readTaskFile(filePath, botId, "", "workspace", diagnostics);
        if (item) items.push(item);
      }

      const chatEntries = readdirSync(botDir, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && entry.name !== "events" && entry.name !== "skills" && entry.name !== "attachments"
      );
      for (const chatEntry of chatEntries) {
        const chatId = chatEntry.name;
        for (const filePath of collectJsonFiles(join(botDir, chatId, "scratch", "events"))) {
          const item = readTaskFile(filePath, botId, chatId, "chat-scratch", diagnostics);
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
    completed: items.filter((item) => item.status === "completed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    error: items.filter((item) => item.status === "error").length
  };
  const countsByScope = {
    workspace: items.filter((item) => item.scope === "workspace").length,
    chatScratch: items.filter((item) => item.scope === "chat-scratch").length
  };

  return json({
    ok: true,
    dataRoot,
    items,
    counts: {
      total: items.length,
      byType: countsByType,
      byStatus: countsByStatus,
      byScope: countsByScope
    },
    diagnostics
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: TaskDeleteBody | TaskTriggerBody;
  try {
    body = (await request.json()) as TaskDeleteBody | TaskTriggerBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const requestedPaths = Array.isArray(body.filePaths)
    ? body.filePaths.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (requestedPaths.length === 0) {
    return json({ ok: false, error: "filePaths is required" }, { status: 400 });
  }

  const botsRoot = resolveTasksRoot();

  if (body.action === "delete") {
    const deleted: string[] = [];
    const failed: Array<{ filePath: string; reason: string }> = [];

    for (const filePath of requestedPaths) {
      const resolvedPath = resolve(filePath);
      if (!isTaskFilePath(resolvedPath, botsRoot)) {
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
    const telegramManagers = runtime.channelManagers.get("telegram") ?? new Map();
    const triggered: string[] = [];
    const failed: Array<{ filePath: string; reason: string }> = [];

    for (const filePath of requestedPaths) {
      const resolvedPath = resolve(filePath);
      if (!isTaskFilePath(resolvedPath, botsRoot)) {
        failed.push({ filePath: resolvedPath, reason: "path_not_allowed" });
        continue;
      }
      if (!existsSync(resolvedPath)) {
        failed.push({ filePath: resolvedPath, reason: "not_found" });
        continue;
      }

      try {
        const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as RawEventTask;
        const context = inferTaskContextFromPath(resolvedPath, botsRoot);
        if (!context) {
          failed.push({ filePath: resolvedPath, reason: "invalid_task_path" });
          continue;
        }

        const item = toTaskItem(parsed, context.botId, context.chatId, context.scope, resolvedPath);
        if (!item) {
          failed.push({ filePath: resolvedPath, reason: "invalid_task_payload" });
          continue;
        }

        const manager = telegramManagers.get(item.botId);
        if (!(manager instanceof TelegramManager)) {
          failed.push({ filePath: resolvedPath, reason: `telegram_manager_not_found:${item.botId}` });
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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/config";

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

export const GET: RequestHandler = async () => {
  const dataRoot = resolve(config.dataDir);
  const botsRoot = join(dataRoot, "moli-t", "bots");
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

import fs from "node:fs";
import path from "node:path";
import type { RuntimeSettings } from "../settings/index.js";
import { storagePaths } from "../infra/db/storage.js";

export const AGENT_PROFILE_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
export const BOT_PROFILE_FILES = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
export const GLOBAL_PROFILE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
  "SONG.md"
] as const;

export type AgentProfileFileName = (typeof AGENT_PROFILE_FILES)[number];
export type BotProfileFileName = (typeof BOT_PROFILE_FILES)[number];
export type GlobalProfileFileName = (typeof GLOBAL_PROFILE_FILES)[number];

type ProfileScope = "global" | "agent" | "bot";

function ensureAllowedFile(fileName: string, allowed: readonly string[]): string {
  const normalized = String(fileName ?? "").trim();
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported profile file: ${normalized}`);
  }
  return normalized;
}

function readFileIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function writeTextFile(filePath: string, content: string): void {
  const next = content.replace(/\r\n/g, "\n").trim();
  if (!next) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${next}\n`, "utf8");
}

export function getAgentsRootDir(): string {
  return path.join(storagePaths.dataDir, "agents");
}

export function getAgentDir(agentId: string): string {
  const normalized = String(agentId ?? "").trim();
  if (!normalized) throw new Error("agentId is required");
  return path.join(getAgentsRootDir(), normalized);
}

export function getBotDir(channel: string, botId: string): string {
  const normalizedChannel = String(channel ?? "").trim();
  const normalizedBotId = String(botId ?? "").trim();
  if (!normalizedChannel || !normalizedBotId) {
    throw new Error("channel and botId are required");
  }
  const channelDir = normalizedChannel === "telegram"
    ? "moli-t"
    : normalizedChannel === "feishu"
      ? "moli-f"
      : normalizedChannel;
  return path.join(storagePaths.dataDir, channelDir, "bots", normalizedBotId);
}

export function listProfileFiles(scope: ProfileScope): readonly string[] {
  if (scope === "global") return GLOBAL_PROFILE_FILES;
  if (scope === "agent") return AGENT_PROFILE_FILES;
  return BOT_PROFILE_FILES;
}

export function readProfileFiles(params: {
  scope: ProfileScope;
  agentId?: string;
  channel?: string;
  botId?: string;
}): Record<string, string> {
  const baseDir = resolveProfileBaseDir(params);
  const files = listProfileFiles(params.scope);
  return Object.fromEntries(files.map((fileName) => [fileName, readFileIfExists(path.join(baseDir, fileName))]));
}

export function writeProfileFiles(params: {
  scope: ProfileScope;
  files: Record<string, string>;
  agentId?: string;
  channel?: string;
  botId?: string;
}): void {
  const baseDir = resolveProfileBaseDir(params);
  const files = listProfileFiles(params.scope);
  for (const fileName of files) {
    if (!(fileName in params.files)) continue;
    writeTextFile(path.join(baseDir, fileName), String(params.files[fileName] ?? ""));
  }
}

function resolveProfileBaseDir(params: {
  scope: ProfileScope;
  agentId?: string;
  channel?: string;
  botId?: string;
}): string {
  if (params.scope === "global") return storagePaths.dataDir;
  if (params.scope === "agent") return getAgentDir(params.agentId ?? "");
  return getBotDir(params.channel ?? "", params.botId ?? "");
}

export function readAgentFiles(agentId: string): Record<AgentProfileFileName, string> {
  return readProfileFiles({ scope: "agent", agentId }) as Record<AgentProfileFileName, string>;
}

export function readBotFiles(channel: string, botId: string): Record<BotProfileFileName, string> {
  return readProfileFiles({ scope: "bot", channel, botId }) as Record<BotProfileFileName, string>;
}

export function getAgentForBot(settings: RuntimeSettings | undefined, channel: string, botId: string): string {
  if (!settings) return "";
  const instances = settings.channels?.[channel]?.instances ?? [];
  return instances.find((instance) => instance.id === botId)?.agentId?.trim() ?? "";
}

export function validateProfileWriteRequest(params: {
  scope: ProfileScope;
  files: Record<string, unknown>;
  agentId?: string;
  channel?: string;
  botId?: string;
}): Record<string, string> {
  const allowed = listProfileFiles(params.scope);
  const next: Record<string, string> = {};
  for (const [fileName, content] of Object.entries(params.files ?? {})) {
    const matched = ensureAllowedFile(fileName, allowed);
    next[matched] = String(content ?? "");
  }
  if (params.scope === "agent" && !String(params.agentId ?? "").trim()) {
    throw new Error("agentId is required");
  }
  if (params.scope === "bot") {
    if (!String(params.channel ?? "").trim()) throw new Error("channel is required");
    if (!String(params.botId ?? "").trim()) throw new Error("botId is required");
  }
  return next;
}

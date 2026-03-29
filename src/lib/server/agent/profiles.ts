import fs from "node:fs";
import path from "node:path";
import type { RuntimeSettings } from "../settings/index.js";
import { storagePaths } from "../infra/db/storage.js";
import agentsTemplate from "./prompts/AGENTS.template.md?raw";
import bootstrapTemplate from "./prompts/BOOTSTRAP.template.md?raw";
import identityTemplate from "./prompts/IDENTITY.template.md?raw";
import soulTemplate from "./prompts/SOUL.template.md?raw";
import toolsTemplate from "./prompts/TOOLS.template.md?raw";
import userTemplate from "./prompts/USER.template.md?raw";

export const AGENT_PROFILE_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
export const BOT_PROFILE_FILES = ["BOT.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md", "SONG.md"] as const;
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

const TEMPLATE_MAP: Partial<Record<string, string>> = {
  "AGENTS.md": agentsTemplate,
  "BOOTSTRAP.md": bootstrapTemplate,
  "IDENTITY.md": identityTemplate,
  "SOUL.md": soulTemplate,
  "TOOLS.md": toolsTemplate,
  "USER.md": userTemplate
};

function ensureAllowedFile(fileName: string, allowed: readonly string[]): string {
  const normalized = String(fileName ?? "").trim();
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported profile file: ${normalized}`);
  }
  return normalized;
}

function readFileIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return normalizeEditableBody(fs.readFileSync(filePath, "utf8"));
}

function writeTextFile(filePath: string, content: string, scope: ProfileScope): void {
  const normalizedFileName = path.basename(filePath);
  const next = content.replace(/\r\n/g, "\n").trim();
  if (!next) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${buildProfileDocument(normalizedFileName, next, scope)}\n`, "utf8");
}

function normalizeEditableBody(content: string): string {
  return content
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/\n---\nlast_updated:[\s\S]*$/m, "")
    .trim();
}

function templateFrontmatter(fileName: string): string | null {
  const template = TEMPLATE_MAP[fileName];
  if (!template) return null;
  const match = template.match(/^---\s*\n[\s\S]*?\n---/);
  return match?.[0] ?? null;
}

function inferFrontmatter(fileName: string, scope: ProfileScope): string {
  const fromTemplate = templateFrontmatter(fileName);
  if (fromTemplate) return fromTemplate;

  const baseName = fileName.replace(/\.md$/i, "");
  const titlePrefix = scope === "agent" ? "Agent" : scope === "bot" ? "Bot" : "Global";
  return [
    "---",
    `title: "${titlePrefix} ${baseName}"`,
    `summary: "${baseName} profile"`,
    "read_when:",
    "  - Every runtime session",
    "---"
  ].join("\n");
}

function buildProfileDocument(fileName: string, content: string, scope: ProfileScope): string {
  const body = normalizeEditableBody(content);
  const heading = body.startsWith("# ") ? body : `# ${fileName}\n\n${body}`;
  return [
    inferFrontmatter(fileName, scope),
    "",
    heading.trim(),
    "",
    "---",
    `last_updated: ${new Date().toISOString().slice(0, 10)}`,
    "owner: user"
  ].join("\n");
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
      : normalizedChannel === "qq"
        ? "moli-q"
      : normalizedChannel === "weixin"
        ? "moli-wx"
      : normalizedChannel === "web"
        ? "moli-w"
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
    writeTextFile(path.join(baseDir, fileName), String(params.files[fileName] ?? ""), params.scope);
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

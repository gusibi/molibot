import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { parseSessionEntries } from "$lib/server/agent/session/session.js";
import type { SessionFileEntry, SessionMessageEntry } from "$lib/server/agent/session/session.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import type { ExternalSessionEntry } from "$lib/server/app/desktopExternalSessions.js";
import type { Channel, Conversation, ConversationMessage } from "$lib/shared/types/message.js";

/**
 * Read-only projection of external-channel conversations from the Agent
 * runtime's `contexts/` store, replacing the retired legacy `sessions/` flat
 * store as the source for the Desktop "External sessions" viewer.
 *
 * Each visible Agent session (`contexts/<sessionId>.jsonl` under
 * `<dataRoot>/<channelDir>/bots/<botId>/<chatId>/`) becomes one external
 * session. Identity is carried in an opaque base64url id so the Desktop can
 * round-trip it through the list → detail endpoints without knowing the
 * underlying tuple. The synthetic `externalUserId`
 * (`bot:<botId>:chat:<chatId>:<sessionId>`) preserves the shape that
 * `parseBotInstanceId()` reads to recover Bot identity for grouping.
 *
 * Lives in the app/upper layer (never in a channel) and only ever reads from
 * `contexts/` — no writes, mirroring `desktopRunHistory` / `conversationThinking`.
 */

const DEFAULT_SESSION_TITLE = "New Session";
const TITLE_MAX = 40;
const EMPTY_TIMESTAMP = new Date(0).toISOString();

export interface ExternalSessionRef {
  channel: Channel;
  botId: string;
  chatId: string;
  sessionId: string;
}

/**
 * Extracts plain display text from an `AgentMessage.content` value, which may be
 * a raw string or an array of content blocks. Only `type:"text"` blocks survive;
 * tool_call / tool_result / thinking blocks are dropped. Mirrors the pattern in
 * `conversationThinking.ts`.
 */
/** Reads `content` off an `AgentMessage` variant that may or may not declare it. */
function messageContent(message: AgentMessage): unknown {
  return (message as { content?: unknown }).content;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const item = part as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("\n");
}

function summarizeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_SESSION_TITLE;
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}...` : clean;
}

/** Path segments are decoded from an opaque id, so guard against traversal. */
function isSafeSegment(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes("..");
}

function sessionKey(ref: ExternalSessionRef): string {
  return `bot:${ref.botId}:chat:${ref.chatId}:${ref.sessionId}`;
}

export function encodeExternalSessionId(ref: ExternalSessionRef): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64url");
}

export function decodeExternalSessionId(id: string): ExternalSessionRef | null {
  try {
    const parsed = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const { channel, botId, chatId, sessionId } = parsed;
    if (
      typeof channel !== "string" ||
      typeof botId !== "string" ||
      typeof chatId !== "string" ||
      typeof sessionId !== "string"
    ) {
      return null;
    }
    if (!isSafeSegment(botId) || !isSafeSegment(chatId) || !isSafeSegment(sessionId)) return null;
    return { channel: channel as Channel, botId, chatId, sessionId };
  } catch {
    return null;
  }
}

function channelDir(channel: Channel): string | null {
  return TASK_CHANNEL_ROOTS.find((root) => root.channel === channel)?.dir ?? null;
}

/**
 * Lists session ids present in a `contexts/` directory. Mirrors
 * `MomRuntimeStore.listSessions` but is strictly read-only (no dir/file
 * creation): a `.json`/`.jsonl` pair collapses to one id; `.meta.json`
 * sidecars are excluded.
 */
function listContextSessionIds(contextsDir: string): string[] {
  if (!existsSync(contextsDir)) return [];
  const ids = new Set<string>();
  for (const name of readdirSync(contextsDir)) {
    if (!name.endsWith(".json") && !name.endsWith(".jsonl")) continue;
    const base = name.replace(/\.(json|jsonl)$/, "");
    if (!base || base.endsWith(".meta")) continue;
    ids.add(base);
  }
  return [...ids].sort();
}

/**
 * Mirrors `MomRuntimeStore.readSessionOrigin` + `listVisibleSessions`: automation
 * (`task-*`) sessions carry `origin:"automation"` in their `.meta.json` and are
 * excluded from ordinary navigation.
 */
function isAutomationSession(contextsDir: string, sessionId: string): boolean {
  if (sessionId.startsWith("task-")) return true;
  const metaFile = join(contextsDir, `${sessionId}.meta.json`);
  if (!existsSync(metaFile)) return false;
  try {
    const parsed = JSON.parse(readFileSync(metaFile, "utf8")) as { origin?: string };
    return parsed?.origin === "automation";
  } catch {
    return false;
  }
}

function isEventPromptSession(entries: SessionFileEntry[]): boolean {
  const firstUser = messageEntriesOf(entries).find((entry) => entry.message.role === "user");
  if (!firstUser) return false;
  return contentText(messageContent(firstUser.message)).trimStart().startsWith("[EVENT:");
}

function readEntries(contextsDir: string, sessionId: string): SessionFileEntry[] {
  const file = join(contextsDir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  try {
    return parseSessionEntries(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function messageEntriesOf(entries: SessionFileEntry[]): SessionMessageEntry[] {
  return entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
}

function buildConversation(ref: ExternalSessionRef, entries: SessionFileEntry[]): Conversation {
  const messageEntries = messageEntriesOf(entries);
  const header = entries.find((entry) => entry.type === "session");
  const firstUser = messageEntries.find((entry) => entry.message.role === "user");
  const lastMessage = messageEntries[messageEntries.length - 1];
  const createdAt = header?.timestamp ?? messageEntries[0]?.timestamp ?? EMPTY_TIMESTAMP;
  const updatedAt = lastMessage?.timestamp ?? createdAt;
  return {
    id: encodeExternalSessionId(ref),
    channel: ref.channel,
    externalUserId: sessionKey(ref),
    title: summarizeTitle(firstUser ? contentText(messageContent(firstUser.message)) : ""),
    createdAt,
    updatedAt
  };
}

function buildMessages(ref: ExternalSessionRef, entries: SessionFileEntry[]): ConversationMessage[] {
  const conversationId = encodeExternalSessionId(ref);
  const messages: ConversationMessage[] = [];
  for (const entry of messageEntriesOf(entries)) {
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = contentText(messageContent(entry.message));
    if (!content.trim()) continue;
    messages.push({ id: entry.id, conversationId, role, content, createdAt: entry.timestamp });
  }
  return messages;
}

/**
 * Enumerates every visible external-channel Agent session across all channel
 * workspaces and projects each into the `ExternalSessionEntry` shape consumed by
 * `buildDesktopExternalSessionsSummary`. Sessions with no user/assistant message
 * entries (e.g. an unused `default` session) are skipped so the list matches the
 * prior "conversations that actually happened" behavior.
 */
export function listExternalSessionsFromContexts(dataRoot: string): ExternalSessionEntry[] {
  const root = resolve(dataRoot);
  const out: ExternalSessionEntry[] = [];
  for (const { channel, dir } of TASK_CHANNEL_ROOTS) {
    const botsRoot = join(root, dir, "bots");
    if (!existsSync(botsRoot)) continue;
    for (const bot of readdirSync(botsRoot, { withFileTypes: true })) {
      if (!bot.isDirectory()) continue;
      const botDir = join(botsRoot, bot.name);
      for (const chat of readdirSync(botDir, { withFileTypes: true })) {
        if (!chat.isDirectory() || chat.name === "skills") continue;
        const contextsDir = join(botDir, chat.name, "contexts");
        for (const sessionId of listContextSessionIds(contextsDir)) {
          if (isAutomationSession(contextsDir, sessionId)) continue;
          const entries = readEntries(contextsDir, sessionId);
          if (isEventPromptSession(entries)) continue;
          const messageEntries = messageEntriesOf(entries);
          if (messageEntries.length === 0) continue;
          const ref: ExternalSessionRef = { channel, botId: bot.name, chatId: chat.name, sessionId };
          const conversation = buildConversation(ref, entries);
          const lastMessage = messageEntries[messageEntries.length - 1];
          const preview = lastMessage
            ? contentText(messageContent(lastMessage.message)).replace(/\s+/g, " ").trim().slice(0, 300)
            : "";
          out.push({ conversation, channel, externalUserId: conversation.externalUserId, preview });
        }
      }
    }
  }
  return out;
}

/**
 * Reads a single external session's transcript by its opaque id. Returns null
 * for malformed ids, unknown channels, or a missing session file so callers can
 * surface a clean 404.
 */
export function readExternalTranscriptFromContexts(
  dataRoot: string,
  id: string
): { conversation: Conversation; messages: ConversationMessage[] } | null {
  const ref = decodeExternalSessionId(id);
  if (!ref) return null;
  const dir = channelDir(ref.channel);
  if (!dir) return null;
  const contextsDir = join(resolve(dataRoot), dir, "bots", ref.botId, ref.chatId, "contexts");
  const file = join(contextsDir, `${ref.sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  const entries = readEntries(contextsDir, ref.sessionId);
  return {
    conversation: buildConversation(ref, entries),
    messages: buildMessages(ref, entries)
  };
}

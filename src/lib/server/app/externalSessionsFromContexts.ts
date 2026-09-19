import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { parseSessionEntries } from "$lib/server/agent/session/session.js";
import { isTaskSessionId } from "$lib/server/agent/session/ids.js";
import type { SessionFileEntry, SessionMessageEntry } from "$lib/server/agent/session/session.js";
import {
  contentText,
  deriveSessionDisplayMetadata,
  isEventPromptSession,
  messageContent,
  readSessionMetadataFile,
  writeSessionDisplayMetadata,
  type SessionDisplayMetadata
} from "$lib/server/agent/session/metadata.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import type { ExternalSessionEntry } from "$lib/server/app/desktopExternalSessions.js";
import type { Channel, Conversation, ConversationMessage, ConversationAttachment } from "$lib/shared/types/message.js";
import { mediaTypeFromName, mimeFromFilename } from "$lib/shared/filePreview.js";
import { isAuthorizedConversationSource, type AuthorizedConversationSource } from "$lib/server/sessions/conversationAuthorization.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";

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

export interface ExternalSessionRef {
  channel: Channel;
  botId: string;
  chatId: string;
  sessionId: string;
}

/** Path segments are decoded from an opaque id, so guard against traversal. */
function isSafeSegment(value: string): boolean {
  return /^[a-zA-Z0-9._\-@:+%]+$/.test(value) && !value.includes("..");
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
 * (`t-*`, formerly `task-*`) sessions carry `origin:"automation"` in their `.meta.json` and are
 * excluded from ordinary navigation.
 */
function isAutomationSession(contextsDir: string, sessionId: string): boolean {
  if (isTaskSessionId(sessionId)) return true;
  const metaFile = join(contextsDir, `${sessionId}.meta.json`);
  if (!existsSync(metaFile)) return false;
  try {
    const parsed = JSON.parse(readFileSync(metaFile, "utf8")) as { origin?: string };
    return parsed?.origin === "automation";
  } catch {
    return false;
  }
}

function readEntries(contextsDir: string, sessionId: string, tailBytesCap?: number): SessionFileEntry[] {
  const file = join(contextsDir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  try {
    const size = statSync(file).size;
    if (tailBytesCap && tailBytesCap > 0 && size > tailBytesCap) {
      // Display read of an oversized transcript: parse only the newest
      // `tailBytesCap` bytes so one huge session cannot pin the event loop.
      // The first tail line is dropped - it is a byte-cut partial line.
      const buffer = Buffer.alloc(tailBytesCap);
      const fd = openSync(file, "r");
      try {
        readSync(fd, buffer, 0, tailBytesCap, size - tailBytesCap);
      } finally {
        closeSync(fd);
      }
      let text = buffer.toString("utf8");
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
      return parseSessionEntries(text);
    }
    return parseSessionEntries(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function messageEntriesOf(entries: SessionFileEntry[]): SessionMessageEntry[] {
  return entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
}

function buildConversation(ref: ExternalSessionRef, entries: SessionFileEntry[]): Conversation {
  const display = deriveSessionDisplayMetadata(entries);
  return conversationFromDisplay(ref, display);
}

/** Builds the list-facing Conversation from already-derived display metadata. */
function conversationFromDisplay(ref: ExternalSessionRef, display: SessionDisplayMetadata): Conversation {
  return {
    id: encodeExternalSessionId(ref),
    channel: ref.channel,
    externalUserId: sessionKey(ref),
    title: display.title,
    createdAt: display.createdAt,
    updatedAt: display.updatedAt
  };
}

/**
 * Recovers generated media (image/video tool outputs) from a toolResult message
 * as displayable attachments. The `imageGenerate`/`videoGenerate` tools never
 * write `message.attachments` - the produced file lives only in the toolResult
 * `details` (`filePath`/`videoPath`). Without this, generated images would never
 * surface in the external transcript. `local` is the path relative to the session
 * workspace so it matches the file-panel scan in `+/api/web/files`.
 */
function extractGeneratedAttachments(message: AgentMessage, workspaceDir: string): ConversationAttachment[] {
  const record = message as { role?: string; toolName?: string; details?: unknown };
  if (record.role !== "toolResult") return [];
  const details = record.details;
  if (!details || typeof details !== "object") return [];
  const detailRecord = details as { filePath?: unknown; videoPath?: unknown };
  const pickFile = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  };
  let filePath: string | undefined;
  let mediaType: "image" | "video" | undefined;
  if (record.toolName === "imageGenerate") {
    filePath = pickFile(detailRecord.filePath);
    mediaType = "image";
  } else if (record.toolName === "videoGenerate") {
    filePath = pickFile(detailRecord.videoPath) ?? pickFile(detailRecord.filePath);
    mediaType = "video";
  }
  if (!filePath || !mediaType) return [];
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceDir, filePath);
  const rel = relative(workspaceDir, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return [];
  return [{ original: basename(resolved), local: rel, mediaType }];
}

/**
 * Recovers user-sent attachments from the `<channel_attachments>` block embedded
 * in persisted user-message text. External channels (Feishu/Telegram/Weixin/QQ)
 * never persist `message.attachments`; instead the inbound attachment paths are
 * folded into the prompt text (see `appendAttachmentBlock`). Without this, user-
 * sent images could not be previewed inline in the external transcript. `local`
 * is the path relative to the session workspace so it matches the Files-pane scan.
 * Returns the extracted attachments plus the display text with the block stripped.
 */
function extractChannelAttachments(content: string, workspaceDir: string): {
  attachments: ConversationAttachment[];
  displayContent: string;
} {
  const match = content.match(/<channel_attachments>\n?([\s\S]*?)<\/channel_attachments>/);
  if (!match) return { attachments: [], displayContent: content };
  const attachments: ConversationAttachment[] = [];
  for (const line of match[1].split("\n")) {
    const candidate = line.trim();
    if (!candidate || !isAbsolute(candidate)) continue;
    const resolved = resolve(candidate);
    const rel = relative(workspaceDir, resolved);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    attachments.push({
      original: basename(resolved),
      local: rel,
      mediaType: mediaTypeFromName(resolved),
      mimeType: mimeFromFilename(resolved) ?? undefined
    });
  }
  const displayContent = content
    .replace(/\n*<channel_attachments>[\s\S]*?<\/channel_attachments>\n*/g, "")
    .trim();
  return { attachments, displayContent };
}

function buildMessages(ref: ExternalSessionRef, entries: SessionFileEntry[], workspaceDir: string): ConversationMessage[] {
  const conversationId = encodeExternalSessionId(ref);
  const messages: ConversationMessage[] = [];
  let pendingAttachments: ConversationAttachment[] = [];
  for (const entry of messageEntriesOf(entries)) {
    const role = entry.message.role;
    if (role === "toolResult") {
      const generated = extractGeneratedAttachments(entry.message, workspaceDir);
      if (generated.length) pendingAttachments = [...pendingAttachments, ...generated];
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    const content = contentText(messageContent(entry.message));

    const attachments: ConversationAttachment[] = [];
    const messageAttachments = (
      entry.message as {
        attachments?: Array<{
          original: string;
          local: string;
          mediaType?: ConversationAttachment["mediaType"];
          mimeType?: string;
          size?: number;
          isImage?: boolean;
          isAudio?: boolean;
        }>;
      }
    ).attachments;
    if (Array.isArray(messageAttachments)) {
      for (const att of messageAttachments) {
        attachments.push({
          original: att.original,
          local: att.local,
          mediaType: att.mediaType || (att.isImage ? "image" : (att.isAudio ? "audio" : "file")),
          mimeType: att.mimeType,
          size: att.size
        });
      }
    }
    let displayContent = content;
    if (role === "user") {
      const { attachments: channelAttachments, displayContent: stripped } = extractChannelAttachments(content, workspaceDir);
      if (channelAttachments.length) {
        attachments.push(...channelAttachments);
        displayContent = stripped;
      }
    }
    if (role === "assistant" && pendingAttachments.length) {
      attachments.push(...pendingAttachments);
      pendingAttachments = [];
    }

    if (!displayContent.trim() && attachments.length === 0) continue;

    messages.push({
      id: entry.id,
      conversationId,
      role,
      content: displayContent,
      createdAt: entry.timestamp,
      attachments: attachments.length > 0 ? attachments : undefined,
      retention: entry.retention
    });
  }
  if (pendingAttachments.length) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") {
        messages[i].attachments = [...(messages[i].attachments ?? []), ...pendingAttachments];
        break;
      }
    }
  }
  return messages;
}

interface ContextSessionRef {
  channel: Channel;
  botId: string;
  chatId: string;
  contextsDir: string;
  sessionId: string;
}

/** Enumerates every session file present under the channel bot workspaces. */
function listContextSessions(root: string): ContextSessionRef[] {
  const out: ContextSessionRef[] = [];
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
          out.push({ channel, botId: bot.name, chatId: chat.name, contextsDir, sessionId });
        }
      }
    }
  }
  return out;
}

function authorizedForContext(
  ref: Pick<ContextSessionRef, "channel" | "botId" | "chatId">,
  authorizedSources?: AuthorizedConversationSource[]
): boolean {
  if (!authorizedSources) return true;
  return authorizedSources.some((source) => isAuthorizedConversationSource(source, {
    botId: ref.botId,
    channel: ref.channel,
    chatId: ref.chatId,
    purpose: "chat"
  }));
}

/**
 * Content-reading enumeration of external sessions. Parses each transcript to
 * derive the title/timestamps and the searchable preview, so it is reserved for
 * flows that genuinely need message text (search, reflection, transcript
 * import). Ordinary lists must use {@link listExternalSessionMetaFromContexts}.
 */
export function listExternalSessionsFromContexts(
  dataRoot: string,
  authorizedSources?: AuthorizedConversationSource[]
): ExternalSessionEntry[] {
  const root = resolve(dataRoot);
  const out: ExternalSessionEntry[] = [];
  for (const entry of listContextSessions(root)) {
    if (isAutomationSession(entry.contextsDir, entry.sessionId)) continue;
    const entries = readEntries(entry.contextsDir, entry.sessionId);
    if (isEventPromptSession(entries)) continue;
    const messageEntries = messageEntriesOf(entries);
    if (messageEntries.length === 0) continue;
    if (!authorizedForContext(entry, authorizedSources)) continue;
    const ref: ExternalSessionRef = {
      channel: entry.channel,
      botId: entry.botId,
      chatId: entry.chatId,
      sessionId: entry.sessionId
    };
    const conversation = buildConversation(ref, entries);
    const lastMessage = [...messageEntries].reverse().find((message) =>
      (message.message.role === "user" || message.message.role === "assistant")
      && retentionCapabilities(message.retention).searchable
    );
    const preview = lastMessage
      ? contentText(messageContent(lastMessage.message)).replace(/\s+/g, " ").trim().slice(0, 300)
      : "";
    out.push({ conversation, channel: entry.channel, externalUserId: conversation.externalUserId, preview });
  }
  return out;
}

/**
 * Lightweight enumeration for the ordinary App lists: reads only the Session
 * metadata sidecar per Session, never the Agent Context transcript. Sessions
 * with no derived metadata are omitted here — the explicit
 * {@link rebuildExternalSessionMetadata} backfill is what materializes metadata
 * for Sessions that predate it, so listing never silently falls back to a full
 * transcript scan.
 */
export function listExternalSessionMetaFromContexts(
  dataRoot: string,
  authorizedSources?: AuthorizedConversationSource[]
): ExternalSessionEntry[] {
  const root = resolve(dataRoot);
  const out: ExternalSessionEntry[] = [];
  for (const entry of listContextSessions(root)) {
    if (isTaskSessionId(entry.sessionId)) continue;
    const metadata = readSessionMetadataFile(entry.contextsDir, entry.sessionId);
    if (metadata?.origin === "automation") continue;
    const display = metadata?.display;
    if (!display?.hasMessages || display.eventPrompt) continue;
    if (!authorizedForContext(entry, authorizedSources)) continue;
    const ref: ExternalSessionRef = {
      channel: entry.channel,
      botId: entry.botId,
      chatId: entry.chatId,
      sessionId: entry.sessionId
    };
    const conversation = conversationFromDisplay(ref, display);
    out.push({ conversation, channel: entry.channel, externalUserId: conversation.externalUserId });
  }
  return out;
}

/**
 * One-time derived-index build: parses Sessions that have no display metadata
 * yet and writes it into their sidecar. Meant to run outside list requests
 * (startup maintenance), so the ordinary list query stays metadata-only. The
 * Session log writer keeps metadata current from then on.
 */
export function rebuildExternalSessionMetadata(dataRoot: string): { scanned: number; rebuilt: number } {
  const root = resolve(dataRoot);
  let scanned = 0;
  let rebuilt = 0;
  for (const entry of listContextSessions(root)) {
    scanned += 1;
    if (readSessionMetadataFile(entry.contextsDir, entry.sessionId)?.display) continue;
    const entries = readEntries(entry.contextsDir, entry.sessionId);
    writeSessionDisplayMetadata(entry.contextsDir, entry.sessionId, deriveSessionDisplayMetadata(entries));
    rebuilt += 1;
  }
  return { scanned, rebuilt };
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
  const workspaceDir = join(resolve(dataRoot), dir, "bots", ref.botId, ref.chatId);
  const contextsDir = join(workspaceDir, "contexts");
  const file = join(contextsDir, `${ref.sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  const entries = readEntries(contextsDir, ref.sessionId, 16 * 1024 * 1024);
  return {
    conversation: buildConversation(ref, entries),
    messages: buildMessages(ref, entries, workspaceDir)
  };
}

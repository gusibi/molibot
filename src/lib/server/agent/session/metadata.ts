import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionFileEntry, SessionMessageEntry } from "./session.js";

/**
 * Session sidecar metadata (`<sessionId>.meta.json`) shared by the Agent store
 * and the upper-layer conversation lists.
 *
 * The Agent store is the single writer of a Session's append-only log, so it is
 * also the only place that can keep display metadata in step with the log. The
 * App list layer then reads this tiny sidecar per Session instead of parsing
 * every Agent Context transcript just to render a title and timestamp.
 */

export interface SessionOriginMetadata {
  origin?: "automation" | "chat";
  taskId?: string;
  runId?: string;
  archiveMode?: "shared";
  returnSessionId?: string;
  createdAt?: string;
}

/**
 * Cheap list/display metadata derived from a Session's log. `title` mirrors the
 * first user message summary, `updatedAt` the newest message timestamp, and the
 * two flags let the list skip empty and internal Event Sessions without opening
 * the transcript.
 */
export interface SessionDisplayMetadata {
  title: string;
  createdAt: string;
  updatedAt: string;
  hasMessages: boolean;
  eventPrompt: boolean;
}

export interface SessionMetadataFile extends SessionOriginMetadata {
  display?: SessionDisplayMetadata;
}

const DEFAULT_SESSION_TITLE = "New Session";
const TITLE_MAX = 40;
const EMPTY_TIMESTAMP = new Date(0).toISOString();

/** Reads `content` off an `AgentMessage` variant that may or may not declare it. */
export function messageContent(message: AgentMessage): unknown {
  return (message as { content?: unknown }).content;
}

/** Extracts plain display text from an `AgentMessage.content` string/blocks. */
export function contentText(content: unknown): string {
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

function messageEntriesOf(entries: SessionFileEntry[]): SessionMessageEntry[] {
  return entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
}

export function isEventPromptSession(entries: SessionFileEntry[]): boolean {
  const firstUser = messageEntriesOf(entries).find((entry) => entry.message.role === "user");
  if (!firstUser) return false;
  return contentText(messageContent(firstUser.message)).trimStart().startsWith("[EVENT:");
}

/** Derives list metadata from a parsed Session log, matching the transcript view. */
export function deriveSessionDisplayMetadata(entries: SessionFileEntry[]): SessionDisplayMetadata {
  const messageEntries = messageEntriesOf(entries);
  const header = entries.find((entry) => entry.type === "session");
  const firstUser = messageEntries.find((entry) => entry.message.role === "user");
  const lastMessage = messageEntries[messageEntries.length - 1];
  const createdAt = header?.timestamp ?? messageEntries[0]?.timestamp ?? EMPTY_TIMESTAMP;
  return {
    title: summarizeTitle(firstUser ? contentText(messageContent(firstUser.message)) : ""),
    createdAt,
    updatedAt: lastMessage?.timestamp ?? createdAt,
    hasMessages: messageEntries.length > 0,
    eventPrompt: isEventPromptSession(entries)
  };
}

export function sessionMetadataPath(contextsDir: string, sessionId: string): string {
  return join(contextsDir, `${sessionId}.meta.json`);
}

export function readSessionMetadataFile(contextsDir: string, sessionId: string): SessionMetadataFile | null {
  const file = sessionMetadataPath(contextsDir, sessionId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SessionMetadataFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Display metadata only, or null when never derived / malformed. */
export function readSessionDisplayMetadata(
  contextsDir: string,
  sessionId: string
): SessionDisplayMetadata | null {
  const display = readSessionMetadataFile(contextsDir, sessionId)?.display;
  if (!display || typeof display !== "object") return null;
  if (typeof display.title !== "string" || typeof display.updatedAt !== "string") return null;
  return display;
}

function writeMetadataFile(contextsDir: string, sessionId: string, metadata: SessionMetadataFile): void {
  writeFileSync(sessionMetadataPath(contextsDir, sessionId), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

/**
 * Merges display metadata into the sidecar, preserving origin/lineage fields.
 * Skips the write when every display field already matches, so ordinary header
 * rewrites that change nothing observable do not churn the file.
 */
export function writeSessionDisplayMetadata(
  contextsDir: string,
  sessionId: string,
  display: SessionDisplayMetadata
): void {
  const existing = readSessionMetadataFile(contextsDir, sessionId);
  if (existing?.display && displayEquals(existing.display, display)) return;
  writeMetadataFile(contextsDir, sessionId, { ...(existing ?? {}), display });
}

/** Merges origin fields into the sidecar, preserving display metadata. */
export function writeSessionOriginMetadata(
  contextsDir: string,
  sessionId: string,
  metadata: SessionOriginMetadata
): SessionMetadataFile {
  const existing = readSessionMetadataFile(contextsDir, sessionId);
  const next: SessionMetadataFile = {
    ...(existing ?? {}),
    ...metadata,
    createdAt: metadata.createdAt ?? existing?.createdAt ?? new Date().toISOString()
  };
  writeMetadataFile(contextsDir, sessionId, next);
  return next;
}

/** Origin fields only; display metadata is an internal implementation detail. */
export function readSessionOriginMetadata(
  contextsDir: string,
  sessionId: string
): SessionOriginMetadata | null {
  const parsed = readSessionMetadataFile(contextsDir, sessionId);
  if (!parsed) return null;
  const { display: _display, ...origin } = parsed;
  return origin;
}

function displayEquals(a: SessionDisplayMetadata, b: SessionDisplayMetadata): boolean {
  return a.title === b.title
    && a.createdAt === b.createdAt
    && a.updatedAt === b.updatedAt
    && a.hasMessages === b.hasMessages
    && a.eventPrompt === b.eventPrompt;
}

import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeThinkingLevel } from "../settings/index.js";

export interface SessionPreferences {
  thinkingLevelOverride?: RuntimeThinkingLevel | null;
}

export interface SessionHeaderEntry {
  type: "session";
  version: 1;
  id: string;
  timestamp: string;
  preferences?: SessionPreferences;
}

export interface SessionEntryBase {
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface SessionCompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  keptMessages: AgentMessage[];
  tokensBefore: number;
  tokensAfter: number;
  summarizedMessages: number;
  reason: "threshold" | "manual";
}

export type SessionEntry = SessionMessageEntry | SessionCompactionEntry;
export type SessionFileEntry = SessionHeaderEntry | SessionEntry;

export interface SessionBuildResult {
  messages: AgentMessage[];
  entries: SessionEntry[];
}

export const CURRENT_SESSION_VERSION = 1;
export const COMPACTION_SUMMARY_PREFIX = "[context summary]";

export function createSessionHeader(sessionId: string): SessionHeaderEntry {
  return {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString()
  };
}

export function createEntryId(): string {
  return randomUUID().slice(0, 8);
}

export function createCompactionSummaryMessage(summary: string, timestamp?: number): AgentMessage {
  return {
    role: "user",
    content: `${COMPACTION_SUMMARY_PREFIX}\n${summary}`.trim(),
    timestamp: timestamp ?? Date.now()
  };
}

export function parseSessionEntries(raw: string): SessionFileEntry[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as SessionFileEntry];
      } catch {
        return [];
      }
    });
}

export function serializeSessionEntries(entries: SessionFileEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

export function buildMessagesFromSessionEntries(entries: SessionFileEntry[]): SessionBuildResult {
  const body = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
  const latestCompactionIndex = [...body].map((entry) => entry.type).lastIndexOf("compaction");
  if (latestCompactionIndex < 0) {
    return {
      messages: body
        .filter((entry): entry is SessionMessageEntry => entry.type === "message")
        .map((entry) => entry.message),
      entries: body
    };
  }

  const latestCompaction = body[latestCompactionIndex] as SessionCompactionEntry;
  const trailingMessages = body
    .slice(latestCompactionIndex + 1)
    .filter((entry): entry is SessionMessageEntry => entry.type === "message")
    .map((entry) => entry.message);

  return {
    messages: [
      createCompactionSummaryMessage(latestCompaction.summary, Date.parse(latestCompaction.timestamp) || Date.now()),
      ...latestCompaction.keptMessages,
      ...trailingMessages
    ],
    entries: body
  };
}

export function isSameMessage(a: AgentMessage, b: AgentMessage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

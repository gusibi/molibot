import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionMessageEntry } from "$lib/server/agent/session/session.js";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import type { UiMessageMetadata } from "$lib/server/sessions/store.js";

export interface ProjectedConversationMessage extends ConversationMessage {
  thinking?: string;
}

interface AgentDisplayMessage extends ProjectedConversationMessage {
  sourceEntryId: string;
}

export interface ConversationProjection {
  messages: ProjectedConversationMessage[];
  migratedMetadataIds: string[];
  /** Metadata rows whose resolved Agent `sourceEntryId` should be persisted (id-based matching from now on). */
  resolvedSourceEntries: Array<{ id: string; sourceEntryId: string }>;
  sourceEntryByMessageId: Map<string, string>;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown };
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("\n");
}

function thinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; thinking?: unknown };
    return item.type === "thinking" && typeof item.thinking === "string" ? [item.thinking.trim()] : [];
  }).filter(Boolean).join("\n\n");
}

function displayUserText(text: string): string {
  return text.replace(/\n*<channel_attachments>[\s\S]*?<\/channel_attachments>\n*/g, "").trim();
}

function modelLabel(message: AgentMessage): string | undefined {
  const row = message as AgentMessage & { provider?: unknown; model?: unknown };
  const provider = typeof row.provider === "string" ? row.provider.trim() : "";
  const model = typeof row.model === "string" ? row.model.trim() : "";
  return [provider, model].filter(Boolean).join("/") || undefined;
}

/** Collapse the Agent tool loop into one user row and the last textual assistant row per turn. */
function agentDisplayMessages(entries: SessionMessageEntry[], conversationId: string): AgentDisplayMessage[] {
  const out: AgentDisplayMessage[] = [];
  let assistant: AgentDisplayMessage | null = null;

  const flushAssistant = () => {
    if (assistant && (assistant.content.trim() || assistant.thinking?.trim())) out.push(assistant);
    assistant = null;
  };

  for (const entry of entries) {
    const role = entry.message.role;
    if (role === "user") {
      flushAssistant();
      const content = displayUserText(contentText(entry.message.content));
      if (!content || content.startsWith("[runtime notice:")) continue;
      out.push({
        id: entry.id,
        sourceEntryId: entry.id,
        conversationId,
        role: "user",
        content,
        createdAt: entry.timestamp
      });
      continue;
    }
    if (role !== "assistant") continue;
    const content = contentText(entry.message.content).trim();
    const thinking = thinkingText(entry.message.content);
    if (!assistant) {
      assistant = {
        id: entry.id,
        sourceEntryId: entry.id,
        conversationId,
        role: "assistant",
        content,
        createdAt: entry.timestamp,
        model: modelLabel(entry.message),
        thinking: thinking || undefined
      };
      continue;
    }
    if (content) {
      assistant.content = content;
      assistant.sourceEntryId = entry.id;
      assistant.createdAt = entry.timestamp;
    }
    const model = modelLabel(entry.message);
    if (model) assistant.model = model;
    if (thinking) assistant.thinking = [assistant.thinking, thinking].filter(Boolean).join("\n\n");
  }
  flushAssistant();
  return out;
}

function normalized(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isNearbyLegacyMessage(candidate: ProjectedConversationMessage, metadata: UiMessageMetadata): boolean {
  const distance = Math.abs(Date.parse(candidate.createdAt) - Date.parse(metadata.createdAt));
  return Number.isFinite(distance) && distance <= 5 * 60_000;
}

/**
 * Deep projection seam: callers provide Agent entries plus UI-only metadata;
 * normal message content is returned from Agent entries exactly once.
 *
 * Matching is anchored on the Agent `sourceEntryId` (persisted onto metadata via
 * `resolvedSourceEntries`) so a stable id, not list position, decides the pairing.
 * Rows without a stored id yet fall back to an order-respecting scan: a `cursor`
 * forbids a later metadata row from stealing an earlier unused Agent row, which is
 * what scrambled hybrid sessions that predate this migration (a legacy display-only
 * row breaks 1:1 alignment and every later reply shifts by one).
 */
export function projectConversationMessages(input: {
  conversationId: string;
  entries: SessionMessageEntry[];
  metadata: UiMessageMetadata[];
}): ConversationProjection {
  const agentMessages = agentDisplayMessages(input.entries, input.conversationId);
  const indexByEntryId = new Map<string, number>();
  agentMessages.forEach((message, index) => indexByEntryId.set(message.sourceEntryId, index));

  const used = new Set<number>();
  const migratedMetadataIds: string[] = [];
  const resolvedSourceEntries: Array<{ id: string; sourceEntryId: string }> = [];
  const sourceEntryByMessageId = new Map<string, string>();
  const messages: ProjectedConversationMessage[] = [];

  let cursor = 0;
  const scanFromCursor = (predicate: (candidate: AgentDisplayMessage) => boolean): number => {
    for (let index = cursor; index < agentMessages.length; index += 1) {
      if (!used.has(index) && predicate(agentMessages[index])) return index;
    }
    return -1;
  };

  for (const metadata of input.metadata) {
    let matchIndex = -1;
    // Phase 1: authoritative id match — order-independent, survives reordering.
    if (metadata.sourceEntryId) {
      const byId = indexByEntryId.get(metadata.sourceEntryId);
      if (byId != null && !used.has(byId) && agentMessages[byId].role === metadata.role) matchIndex = byId;
    }
    // Phase 2: context-backed rows carry no content of their own — bind to the
    // next in-order Agent row of the same role.
    if (matchIndex < 0 && (metadata.contextBacked || metadata.content == null)) {
      matchIndex = scanFromCursor((candidate) => candidate.role === metadata.role);
    }
    // Phase 3: legacy display-only rows migrate only onto a nearby identical Agent row.
    if (matchIndex < 0 && metadata.content != null) {
      matchIndex = scanFromCursor((candidate) =>
        candidate.role === metadata.role
        && isNearbyLegacyMessage(candidate, metadata)
        && normalized(candidate.content) === normalized(metadata.content));
    }

    if (matchIndex < 0) {
      // Never silently drop a row: keep display-only content, or an empty
      // placeholder for a context-backed row whose Agent source has rotated away.
      messages.push({ ...metadata, content: metadata.content ?? "" });
      continue;
    }

    used.add(matchIndex);
    cursor = Math.max(cursor, matchIndex + 1);
    const source = agentMessages[matchIndex];
    sourceEntryByMessageId.set(metadata.id, source.sourceEntryId);
    if (metadata.sourceEntryId !== source.sourceEntryId) {
      resolvedSourceEntries.push({ id: metadata.id, sourceEntryId: source.sourceEntryId });
    }
    if (!metadata.contextBacked) migratedMetadataIds.push(metadata.id);
    messages.push({
      ...source,
      id: metadata.id,
      createdAt: metadata.createdAt || source.createdAt,
      model: metadata.model || source.model,
      platformMessageId: metadata.platformMessageId,
      attachments: metadata.attachments,
      activities: metadata.activities
    });
  }

  agentMessages.forEach((message, index) => {
    if (used.has(index)) return;
    sourceEntryByMessageId.set(message.id, message.sourceEntryId);
    messages.push(message);
  });
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages, migratedMetadataIds, resolvedSourceEntries, sourceEntryByMessageId };
}

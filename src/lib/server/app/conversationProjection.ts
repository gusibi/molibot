import type { AgentMessage } from "@mariozechner/pi-agent-core";
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
 */
export function projectConversationMessages(input: {
  conversationId: string;
  entries: SessionMessageEntry[];
  metadata: UiMessageMetadata[];
}): ConversationProjection {
  const agentMessages = agentDisplayMessages(input.entries, input.conversationId);
  const used = new Set<number>();
  const migratedMetadataIds: string[] = [];
  const sourceEntryByMessageId = new Map<string, string>();
  const messages: ProjectedConversationMessage[] = [];

  for (const metadata of input.metadata) {
    const matchIndex = agentMessages.findIndex((candidate, index) => {
      if (used.has(index) || candidate.role !== metadata.role) return false;
      return metadata.contextBacked || (
        isNearbyLegacyMessage(candidate, metadata)
        && normalized(candidate.content) === normalized(metadata.content)
      );
    });
    if (matchIndex < 0) {
      if (metadata.content != null) messages.push({ ...metadata, content: metadata.content });
      continue;
    }
    used.add(matchIndex);
    const source = agentMessages[matchIndex];
    sourceEntryByMessageId.set(metadata.id, source.sourceEntryId);
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
  return { messages, migratedMetadataIds, sourceEntryByMessageId };
}

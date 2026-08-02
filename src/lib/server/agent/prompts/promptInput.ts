import { formatIsoInTimeZone, localDateKeyInTimeZone, normalizeTimeZone } from "$lib/server/time.js";
import { formatMemoryShortId, MEMORY_CITATION_INSTRUCTION } from "$lib/server/memory/citation.js";
import { resolveScratchArtifactDir } from "$lib/server/agent/session/scratchArtifacts.js";
import type {
  MemoryInjectionSnapshot,
  MemoryPromptSnapshot,
  MemoryRecord
} from "$lib/server/memory/types.js";

interface PromptInputEnvelopeOptions {
  messageText: string;
  /**
   * What the transcript stores, when it must differ from what the model reads.
   * Routing hints the runner consumed (a leading `@app` selector) belong in the
   * session record — dropping them makes the owner's own message unrecognizable
   * in the UI — but not in the model message, where routing already applied.
   */
  persistedText?: string;
  /** Ephemeral runner controls. Never copied to persisted conversation data. */
  runtimeInstructions?: string[];
  attachmentPaths?: string[];
  messageTimestamp?: string | number | Date;
  timezone: string;
  memorySnapshot?: MemoryPromptSnapshot;
}

const MAX_INJECTED_MEMORIES = 5;
const MAX_INJECTED_MEMORY_LINE_LENGTH = 220;

function compactMemoryLine(index: number, shortId: string, record: MemoryRecord): string {
  const line = `${index}. [${shortId}] ${record.content}`.replace(/\s+/g, " ").trim();
  return line.length > MAX_INJECTED_MEMORY_LINE_LENGTH
    ? `${line.slice(0, MAX_INJECTED_MEMORY_LINE_LENGTH - 1).trimEnd()}…`
    : line;
}

function withShortIdPrefix(promptText: string, shortId: string): string {
  const trimmed = promptText.trimStart();
  if (trimmed.startsWith("- ")) return `- [${shortId}] ${trimmed.slice(2)}`;
  return `[${shortId}] ${trimmed}`;
}

export function materializeMemoryInjection(snapshot?: MemoryPromptSnapshot): MemoryInjectionSnapshot {
  const profileItems = snapshot?.profile?.effectiveItems ?? [];
  if (!snapshot || (snapshot.selected.length === 0 && profileItems.length === 0)) {
    return {
      createdAt: snapshot?.createdAt ?? new Date(0).toISOString(),
      query: snapshot?.query ?? "",
      fingerprint: snapshot?.fingerprint ?? "empty",
      promptText: "",
      items: []
    };
  }

  const profileIds = new Set(profileItems.map((item) => item.memoryId));
  const selected = snapshot.selected.filter((record) => !profileIds.has(record.id)).slice(0, MAX_INJECTED_MEMORIES);
  // Citation short ids number every injected item (profile first, then
  // retrieved) so the model can cite exactly which memories informed a reply.
  const numberedProfileItems = profileItems.map((item, order) => {
    const shortId = formatMemoryShortId(order + 1);
    return { ...item, order, shortId, promptText: withShortIdPrefix(item.promptText, shortId) };
  });
  let longTermIndex = 0;
  let dailyIndex = 0;
  const retrievedItems = selected.map((record, order) => {
    const index = record.layer === "daily" ? ++dailyIndex : ++longTermIndex;
    const shortId = formatMemoryShortId(numberedProfileItems.length + order + 1);
    const promptText = compactMemoryLine(index, shortId, record);
    return {
      memoryId: record.id,
      order,
      shortId,
      promptText,
      source: "retrieved" as const,
      namespace: record.namespace,
      domain: record.domain,
      snapshot: {
        displayText: record.content,
        content: record.content,
        layer: record.layer,
        type: record.type,
        confidence: record.confidence,
        reason: record.reason,
        tags: [...record.tags],
        updatedAt: record.updatedAt
      }
    };
  });
  const hasLongTerm = selected.some((record) => record.layer !== "daily");
  const items = [
    ...numberedProfileItems,
    ...retrievedItems.map((item, offset) => ({ ...item, order: numberedProfileItems.length + offset }))
  ];
  const promptText = [
    numberedProfileItems.length > 0 ? "Stable profile:" : "",
    ...numberedProfileItems.map((item) => item.promptText),
    selected.length > 0 ? (hasLongTerm ? "Retrieved long-term memory (trimmed):" : "Retrieved memory:") : "",
    ...retrievedItems.map((item) => item.promptText),
    items.length > 0 ? MEMORY_CITATION_INSTRUCTION : ""
  ].filter(Boolean).join("\n");
  return {
    createdAt: snapshot.createdAt,
    query: snapshot.query,
    fingerprint: snapshot.fingerprint,
    promptText,
    items
  };
}

// Working-memory snapshots ride inside the per-turn envelope (model message
// only) instead of the system prompt, so the system prompt stays byte-identical
// across turns and provider prefix caching keeps covering it plus history.
export function compactPromptMemory(memory: string): string {
  const source = String(memory ?? "").trim();
  if (!source) return "(none)";

  const rawLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const kept: string[] = [];
  let itemCount = 0;
  for (const line of rawLines) {
    if (/^recent daily memory:?$/i.test(line)) {
      continue;
    }
    if (/^long-term memory:?$/i.test(line)) {
      kept.push("Long-term memory (trimmed):");
      continue;
    }
    if (/^\d+\.\s*/.test(line)) {
      itemCount += 1;
      if (itemCount > 5) continue;
      const compact = line.replace(/\s+/g, " ").trim();
      kept.push(compact.length > 220 ? `${compact.slice(0, 219).trimEnd()}…` : compact);
      continue;
    }
    if (kept.length < 8) {
      const compact = line.replace(/\s+/g, " ").trim();
      kept.push(compact.length > 220 ? `${compact.slice(0, 219).trimEnd()}…` : compact);
    }
  }

  if (kept.length === 0) return "(none)";
  return kept.join("\n");
}

function resolveMessageTimestamp(value: PromptInputEnvelopeOptions["messageTimestamp"]): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const ms = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
        return new Date(ms);
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function appendAttachmentBlock(baseText: string, attachmentPaths: string[]): string {
  if (attachmentPaths.length === 0) return baseText;
  return `${baseText}\n\n<channel_attachments>\n${attachmentPaths.join("\n")}\n</channel_attachments>`;
}

export function buildPromptInputEnvelope(options: PromptInputEnvelopeOptions): {
  modelMessage: string;
  persistedMessage: string;
  memoryInjection: MemoryInjectionSnapshot;
} {
  const timeZone = normalizeTimeZone(options.timezone);
  const messageDate = resolveMessageTimestamp(options.messageTimestamp);
  const attachmentPaths = [...(options.attachmentPaths ?? [])].filter(Boolean);
  const receivedAt = formatIsoInTimeZone(messageDate, timeZone);
  const today = localDateKeyInTimeZone(messageDate, timeZone);
  const scratchArtifactDir = resolveScratchArtifactDir(timeZone, messageDate);
  const persistedMessage = appendAttachmentBlock(
    options.persistedText ?? options.messageText,
    attachmentPaths
  );
  const memoryInjection = materializeMemoryInjection(options.memorySnapshot);
  const memoryText = memoryInjection.promptText;
  const memoryBlock = memoryText
    ? ["<current-memory>", memoryText, "</current-memory>", ""]
    : [];
  const modelMessage = appendAttachmentBlock(
    [
      "<env>",
      `message_received_at: ${receivedAt}`,
      `timezone: ${timeZone}`,
      `today: ${today}`,
      `scratch_artifact_dir: ${scratchArtifactDir}`,
      "</env>",
      "",
      ...memoryBlock,
      ...(options.runtimeInstructions?.filter(Boolean).flatMap((instruction) => ["<runtime-control>", instruction, "</runtime-control>", ""]) ?? []),
      "<user_message>",
      options.messageText,
      "</user_message>"
    ].join("\n"),
    attachmentPaths
  );

  return {
    modelMessage,
    persistedMessage,
    memoryInjection
  };
}

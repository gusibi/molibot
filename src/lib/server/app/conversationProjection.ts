import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionMessageEntry } from "$lib/server/agent/session/session.js";
import type { ConversationActivity, ConversationMessage, ConversationPlan, ConversationStep } from "$lib/shared/types/message.js";
import type { UiMessageMetadata } from "$lib/server/sessions/store.js";
import { stripMemoryCitations } from "$lib/server/memory/citation.js";

export interface ProjectedConversationMessage extends ConversationMessage {
  thinking?: string;
  stopReason?: string;
  errorMessage?: string;
}

interface AgentDisplayMessage extends ProjectedConversationMessage {
  sourceEntryId: string;
}

type ConversationUsage = NonNullable<ConversationMessage["usage"]>;

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

function messageUsage(message: AgentMessage): ConversationUsage {
  const usage = (message as AgentMessage & { usage?: Record<string, unknown> }).usage ?? {};
  const inputTokens = Number(usage.input ?? 0);
  const outputTokens = Number(usage.output ?? 0);
  const cacheReadTokens = Number(usage.cacheRead ?? 0);
  const cacheWriteTokens = Number(usage.cacheWrite ?? 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: Number(usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens)
  };
}

function addUsage(left: ConversationUsage | undefined, right: ConversationUsage): ConversationUsage {
  return {
    inputTokens: (left?.inputTokens ?? 0) + right.inputTokens,
    outputTokens: (left?.outputTokens ?? 0) + right.outputTokens,
    cacheReadTokens: (left?.cacheReadTokens ?? 0) + right.cacheReadTokens,
    cacheWriteTokens: (left?.cacheWriteTokens ?? 0) + right.cacheWriteTokens,
    totalTokens: (left?.totalTokens ?? 0) + right.totalTokens
  };
}

function orderedAssistantSteps(message: AgentMessage, entryId: string): ConversationStep[] {
  const content = (message as AgentMessage & { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part, index): ConversationStep[] => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
    const id = `${entryId}-${index}`;
    if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim()) {
      return [{ id, kind: "thinking", content: item.thinking.trim() }];
    }
    if (item.type === "text" && typeof item.text === "string") {
      const text = displayAssistantText(item.text).trim();
      return text ? [{ id, kind: "text", content: text }] : [];
    }
    if (item.type === "toolCall") {
      const tool = typeof item.name === "string" ? item.name : "tool";
      const key = typeof item.id === "string" && item.id ? item.id : id;
      if (tool === "exitPlan" && item.arguments && typeof item.arguments === "object") {
        const args = item.arguments as { title?: unknown; summary?: unknown; steps?: unknown; recommendedMode?: unknown };
        const planId = `plan-${key}`;
        const plan: ConversationPlan = {
          id: planId,
          title: String(args.title ?? "Plan").trim(),
          summary: String(args.summary ?? "").trim(),
          steps: (Array.isArray(args.steps) ? args.steps : []).map((text, stepIndex) => ({
            id: `${planId}-${stepIndex + 1}`,
            text: String(text),
            status: "pending"
          })),
          status: "proposed",
          recommendedMode: args.recommendedMode === "manual" ? "manual" : "accept_edits",
          artifactPath: ""
        };
        return [{ id, kind: "plan", plan }];
      }
      return [{
        id,
        kind: "activity",
        activity: { key, kind: "tool", tool, label: tool, state: "running" }
      }];
    }
    return [];
  });
}

function hydratePlanSteps(steps: ConversationStep[] | undefined, plan: ConversationPlan | undefined): ConversationStep[] | undefined {
  if (!steps?.length || !plan) return steps;
  return steps.map((step) => step.kind === "plan" ? { ...step, plan } : step);
}

/**
 * A Plan is a turn-level decision, not raw tool chronology. Retry/continuation
 * paths can split one user turn across several assistant rows, so the durable
 * metadata Plan is canonical: remove reconstructed exitPlan blocks from that
 * turn and render the canonical decision once, after its last assistant row.
 */
function projectTurnPlans(messages: ProjectedConversationMessage[]): ProjectedConversationMessage[] {
  const projected = [...messages];
  let turnStart = 0;
  const projectTurn = (start: number, end: number) => {
    const indexes: number[] = [];
    let canonicalPlan: ConversationPlan | undefined;
    for (let index = start; index < end; index += 1) {
      const message = projected[index];
      if (message.role !== "assistant") continue;
      indexes.push(index);
      if (message.plan) canonicalPlan = message.plan;
    }
    if (!indexes.length || !canonicalPlan) return;
    for (const index of indexes) {
      const message = projected[index];
      projected[index] = {
        ...message,
        steps: message.steps?.filter((step) => step.kind !== "plan")
      };
    }
    const targetIndex = indexes.at(-1)!;
    const target = projected[targetIndex];
    projected[targetIndex] = {
      ...target,
      steps: [
        ...(target.steps ?? []),
        { id: `${target.id}-plan-${canonicalPlan.id}`, kind: "plan" as const, plan: canonicalPlan }
      ]
    };
  };

  for (let index = 0; index <= projected.length; index += 1) {
    if (index < projected.length && projected[index].role !== "user") continue;
    projectTurn(turnStart, index);
    turnStart = index;
  }
  return projected;
}

function hydrateActivitySteps(
  steps: ConversationStep[] | undefined,
  activities: ConversationActivity[] | undefined
): ConversationStep[] | undefined {
  if (!steps?.length) return steps;
  const remaining = [...(activities ?? [])];
  return steps.map((step) => {
    if (step.kind !== "activity") return step;
    const exact = remaining.findIndex((activity) => activity.key === step.activity.key);
    const byTool = remaining.findIndex((activity) => activity.tool === step.activity.tool);
    const index = exact >= 0 ? exact : byTool;
    if (index < 0) return step;
    const [activity] = remaining.splice(index, 1);
    return { ...step, activity };
  });
}

function displayUserText(text: string): string {
  return text.replace(/\n*<channel_attachments>[\s\S]*?<\/channel_attachments>\n*/g, "").trim();
}

// Context-backed assistant rows re-read the raw model output, which may end in
// a memory-citation marker ([[mem:M1]]); it is model-facing bookkeeping and
// must never render in a transcript.
function displayAssistantText(text: string): string {
  return stripMemoryCitations(text).text;
}

function modelLabel(message: AgentMessage): string | undefined {
  const row = message as AgentMessage & { provider?: unknown; model?: unknown };
  const provider = typeof row.provider === "string" ? row.provider.trim() : "";
  const model = typeof row.model === "string" ? row.model.trim() : "";
  return [provider, model].filter(Boolean).join("/") || undefined;
}

function assistantStatus(message: AgentMessage): { stopReason?: string; errorMessage?: string } {
  const row = message as AgentMessage & { stopReason?: unknown; errorMessage?: unknown };
  const stopReason = typeof row.stopReason === "string" ? row.stopReason.trim() : "";
  const errorMessage = typeof row.errorMessage === "string" ? row.errorMessage.trim() : "";
  return { stopReason: stopReason || undefined, errorMessage: errorMessage || undefined };
}

/** Collapse one user turn into one answer while preserving all terminal text. */
function agentDisplayMessages(entries: SessionMessageEntry[], conversationId: string): AgentDisplayMessage[] {
  const out: AgentDisplayMessage[] = [];
  let assistant: AgentDisplayMessage | null = null;
  let terminalCommitted = false;
  let terminalReplies: string[] = [];

  const flushAssistant = () => {
    if (assistant) {
      // An error is a *status*, not a reply. It only stands in as the bubble
      // body when the turn produced no text at all — otherwise the transcript
      // shows the answer and renders the error alongside it.
      if (!assistant.content.trim() && assistant.errorMessage?.trim()) {
        assistant.content = assistant.errorMessage.trim();
        assistant.steps = [...(assistant.steps ?? []), {
          id: `${assistant.sourceEntryId}-error`,
          kind: "text",
          content: assistant.content
        }];
      }
      if (terminalCommitted && assistant.content.trim()) {
        assistant.steps = [...(assistant.steps ?? []), {
          id: `${assistant.sourceEntryId}-response`,
          kind: "text",
          content: assistant.content.trim()
        }];
      }
      if (assistant.content.trim() || assistant.thinking?.trim() || assistant.errorMessage?.trim()) out.push(assistant);
    }
    assistant = null;
    terminalCommitted = false;
    terminalReplies = [];
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
        createdAt: entry.timestamp,
        retention: entry.retention
      });
      continue;
    }
    if (role !== "assistant") continue;
    const status = assistantStatus(entry.message);
    // Deliberately NOT falling back to `status.errorMessage` here. A turn ends
    // with a content-less assistant entry whenever the run was aborted (budget
    // guard, user Stop, provider abort). Treating that entry's error string as
    // "content" made it overwrite the real answer the same turn had already
    // produced — the user lost the reply and got a bare "Request aborted".
    const content = displayAssistantText(contentText(entry.message.content).trim());
    const thinking = thinkingText(entry.message.content);
    const steps = orderedAssistantSteps(entry.message, entry.id);
    const usage = messageUsage(entry.message);
    const isTerminalReply = status.stopReason === "stop" && Boolean(content);
    const displaySteps = isTerminalReply ? steps.filter((step) => step.kind !== "text") : steps;
    if (!assistant) {
      assistant = {
        id: entry.id,
        sourceEntryId: entry.id,
        conversationId,
        role: "assistant",
        content,
        createdAt: entry.timestamp,
        retention: entry.retention,
        model: modelLabel(entry.message),
        thinking: thinking || undefined,
        steps: displaySteps,
        usage,
        ...status
      };
      terminalCommitted = isTerminalReply;
      terminalReplies = isTerminalReply ? [content] : [];
      continue;
    }
    // A provider/runtime continuation may emit another terminal assistant
    // message without another user prompt. Keep one answer container for the
    // turn and append its terminal text instead of manufacturing another row.
    // Non-terminal progress remains in ordered `steps` and cannot overwrite a
    // committed answer.
    if (isTerminalReply) {
      if (!terminalReplies.includes(content)) terminalReplies.push(content);
      assistant.content = terminalReplies.join("\n\n");
      assistant.sourceEntryId = entry.id;
      assistant.createdAt = entry.timestamp;
    } else if (content && !terminalCommitted) {
      assistant.content = content;
      assistant.sourceEntryId = entry.id;
      assistant.createdAt = entry.timestamp;
    }
    const model = modelLabel(entry.message);
    if (model) assistant.model = model;
    if (thinking) assistant.thinking = [assistant.thinking, thinking].filter(Boolean).join("\n\n");
    assistant.steps = [...(assistant.steps ?? []), ...displaySteps];
    assistant.usage = addUsage(assistant.usage, usage);
    if (status.stopReason && (!terminalCommitted || status.stopReason !== "toolUse")) {
      assistant.stopReason = status.stopReason;
    }
    if (status.errorMessage) assistant.errorMessage = status.errorMessage;
    if (isTerminalReply) terminalCommitted = true;
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
      const content = metadata.content ?? "";
      messages.push({
        ...metadata,
        content,
        steps: metadata.role === "assistant" && content
          ? [{ id: `${metadata.id}-text`, kind: "text", content }]
          : undefined
      });
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
    const activities = metadata.activities;
    messages.push({
      ...source,
      id: metadata.id,
      createdAt: metadata.createdAt || source.createdAt,
      model: metadata.model || source.model,
      durationMs: metadata.durationMs ?? source.durationMs,
      platformMessageId: metadata.platformMessageId,
      attachments: metadata.attachments,
      activities,
      steps: hydratePlanSteps(hydrateActivitySteps(source.steps, activities), metadata.plan),
      plan: metadata.plan,
      retention: metadata.retention ?? source.retention
    });
  }

  agentMessages.forEach((message, index) => {
    if (used.has(index)) return;
    sourceEntryByMessageId.set(message.id, message.sourceEntryId);
    messages.push(message);
  });
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { messages: projectTurnPlans(messages), migratedMetadataIds, resolvedSourceEntries, sourceEntryByMessageId };
}

import { buildExtractionRevision } from "$lib/server/sessions/sessionExtractionService.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import type { MemoryScope } from "./types.js";
import type { ExtractedMemoryItem, MemoryWriterPort } from "./memoryWriter.js";
import { normalizeSubject } from "./memoryWriter.js";
import type { MemoryExtractionState, MemoryExtractionStatePort } from "./memoryExtractionStore.js";

const MAX_TAIL_MESSAGES = 80;
const MAX_TAIL_CHARS = 24_000;
const DOMAINS = new Set(["owner", "project", "agent_self"]);
const TYPES = new Set(["user_preference", "user_fact", "skill", "event", "task", "world_knowledge"]);

export interface MemoryExtractionSession {
  conversationId: string;
  source: "local" | "project" | "external";
  channel: string;
  botId: string;
  projectId?: string;
  agentId?: string;
  ownerExternalUserId: string | null;
  lastActivityAt: string | null;
  updatedAt: string;
  userTurnCount?: number;
  assistantTurnCount?: number;
  /** The owning Agent's owner-memory sharing switch; absent means shared. */
  shareOwner?: boolean;
}

export interface MemoryExtractionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface MemoryExtractionOutput {
  noUsefulInformation?: boolean;
  memories?: ExtractedMemoryItem[];
}

export type MemoryExtractionExtractor = (input: {
  conversationId: string;
  channel: string;
  botId: string;
  projectId: string | null;
  agentId: string | null;
  messages: MemoryExtractionMessage[];
  relatedMemories: Array<{ subject: string; value: string }>;
}) => Promise<MemoryExtractionOutput | null | undefined>;

export interface MemoryExtractionSweepResult {
  scanned: number;
  attempted: number;
  committed: number;
  proposals: number;
  skipped: number;
  failed: number;
  skippedBecauseInFlight: boolean;
}

export interface MemoryExtractionServiceDeps {
  listSessions: (options: { limit: number; offset: number }) => {
    items: MemoryExtractionSession[];
    total: number;
  };
  listMessages: (conversationId: string) => ConversationMessage[];
  store: MemoryExtractionStatePort;
  writer: MemoryWriterPort;
  extractor: MemoryExtractionExtractor;
  /** Related records let the extractor reuse a subject instead of inventing a new one. */
  relatedMemories?: (
    scope: MemoryScope,
    messages: MemoryExtractionMessage[]
  ) => Promise<Array<{ subject: string; value: string }>>;
  /** The user's memory kill switch; a disabled plugin must not spend model calls. */
  enabled?: () => boolean;
  ownerId?: string;
  botId?: string;
  /** A Session must be quiet this long before its tail is extracted. */
  minIdleMs?: number;
  /** Bound model cost per sweep; the rest waits for the next tick. */
  maxSessionsPerSweep?: number;
  /** Never bootstrap the entire history on first run. */
  maxLookbackMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * Automatic memory extraction for idle Sessions. Runs on the runtime's memory
 * timer: no per-channel hooks, no per-turn model call, and no dependency on the
 * manual "extract and archive" flow. The watermark makes repeated sweeps
 * idempotent; a failed extraction backs off instead of retrying every minute.
 */
export class MemoryExtractionService {
  private inFlight = false;
  private readonly ownerId: string;
  private readonly botId: string;
  private readonly minIdleMs: number;
  private readonly maxSessionsPerSweep: number;
  private readonly maxLookbackMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: MemoryExtractionServiceDeps) {
    this.ownerId = deps.ownerId ?? "owner";
    this.botId = deps.botId ?? "web";
    this.minIdleMs = Math.max(0, deps.minIdleMs ?? 90_000);
    this.maxSessionsPerSweep = Math.max(1, deps.maxSessionsPerSweep ?? 3);
    this.maxLookbackMs = Math.max(this.minIdleMs, deps.maxLookbackMs ?? 7 * 86_400_000);
    this.now = deps.now ?? (() => new Date());
  }

  async runSweep(options: { force?: boolean } = {}): Promise<MemoryExtractionSweepResult> {
    if (this.inFlight) {
      return { scanned: 0, attempted: 0, committed: 0, proposals: 0, skipped: 0, failed: 0, skippedBecauseInFlight: true };
    }
    if (this.deps.enabled && !this.deps.enabled()) {
      return { scanned: 0, attempted: 0, committed: 0, proposals: 0, skipped: 0, failed: 0, skippedBecauseInFlight: false };
    }
    this.inFlight = true;
    const result: MemoryExtractionSweepResult = {
      scanned: 0,
      attempted: 0,
      committed: 0,
      proposals: 0,
      skipped: 0,
      failed: 0,
      skippedBecauseInFlight: false
    };

    try {
      const now = this.now();
      const nowMs = now.getTime();
      const sessions = this.collectSessions();
      result.scanned = sessions.length;

      for (const session of sessions) {
        if (result.attempted >= this.maxSessionsPerSweep) break;
        if (session.source === "external") continue;
        const activity = Date.parse(session.lastActivityAt ?? session.updatedAt ?? "");
        if (!Number.isFinite(activity)) continue;
        if (nowMs - activity > this.maxLookbackMs) continue;

        const state = this.deps.store.get(session.conversationId);
        if (state?.retryAfter && Date.parse(state.retryAfter) > nowMs) continue;

        // A long continuous conversation may never go idle for 90s. After 20
        // completed turns, let it through at most once every ten minutes.
        const turns = (session.userTurnCount ?? 0) + (session.assistantTurnCount ?? 0);
        const lastExtraction = state ? Date.parse(state.updatedAt) : 0;
        const longSessionDue = turns >= 20
          && (!state || (Number.isFinite(lastExtraction) && nowMs - lastExtraction >= 10 * 60_000));
        if (!options.force && !longSessionDue && nowMs - activity < this.minIdleMs) continue;

        const messages = this.eligibleMessages(session.conversationId);
        const last = messages.at(-1);
        // Only completed exchanges: an assistant still working has no reply yet,
        // and extracting the user half would remember a question as a fact.
        if (!last || last.role !== "assistant") continue;
        if (state?.processedThroughId === last.id) continue;

        const tail = tailAfter(messages, state?.processedThroughId);
        if (tail.length === 0) continue;

        result.attempted += 1;
        try {
          const scope = this.scopeFor(session);
          const relatedMemories = this.deps.relatedMemories
            ? await this.deps.relatedMemories(scope, tail)
            : [];
          const output = await this.deps.extractor({
            conversationId: session.conversationId,
            channel: session.channel,
            botId: session.botId || this.botId,
            projectId: session.projectId ?? null,
            agentId: session.agentId ?? null,
            messages: tail,
            relatedMemories
          });
          const relatedSubjects = new Set(relatedMemories.map((memory) => normalizeSubject(memory.subject)));
          const items = normalizeOutput(output).map((item) => {
            // Only an existing related subject may be revised; a hallucinated
            // supersedesSubject must not overwrite an unrelated fact.
            const target = item.supersedesSubject ? normalizeSubject(item.supersedesSubject) : "";
            return target && relatedSubjects.has(target) ? { ...item, subject: target } : item;
          });
          if (items.length === 0) {
            this.deps.store.set(session.conversationId, succeeded(last.id, messages, now));
            continue;
          }

          const write = await this.deps.writer.write(
            scope,
            items,
            tail.map((message) => ({
              channel: session.channel,
              sessionId: session.conversationId,
              conversationMessageId: message.id,
              observedAt: message.createdAt
            })),
            `extract:${session.conversationId}:${last.id}`
          );
          result.committed += write.committed.length;
          result.proposals += write.proposals.length;
          result.skipped += write.skipped;

          if (write.failures.length > 0) {
            this.deps.store.set(
              session.conversationId,
              failed(state, messages, now, write.failures.join("；"))
            );
            result.failed += 1;
            continue;
          }
          this.deps.store.set(session.conversationId, succeeded(last.id, messages, now));
        } catch (error) {
          this.deps.store.set(
            session.conversationId,
            failed(state, messages, now, error instanceof Error ? error.message : String(error))
          );
          result.failed += 1;
        }
      }
    } finally {
      this.inFlight = false;
    }

    if (result.attempted > 0) {
      this.deps.log?.(
        `extraction sweep scanned=${result.scanned} attempted=${result.attempted} committed=${result.committed} proposals=${result.proposals} skipped=${result.skipped} failed=${result.failed}`
      );
    }
    return result;
  }

  private collectSessions(): MemoryExtractionSession[] {
    const collected: MemoryExtractionSession[] = [];
    const pageSize = 100;
    let offset = 0;
    for (;;) {
      const page = this.deps.listSessions({ limit: pageSize, offset });
      collected.push(...page.items);
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total || collected.length >= 500) break;
    }
    return collected;
  }

  private eligibleMessages(conversationId: string): MemoryExtractionMessage[] {
    return this.deps
      .listMessages(conversationId)
      .filter((message) =>
        (message.role === "user" || message.role === "assistant")
        && retentionCapabilities(message.retention).memoryEligible
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
        createdAt: message.createdAt
      }));
  }

  private scopeFor(session: MemoryExtractionSession): MemoryScope {
    return {
      channel: session.channel,
      externalUserId: session.ownerExternalUserId ?? `session:${session.conversationId}`,
      botId: session.botId || this.botId,
      agentId: session.agentId,
      ownerId: this.ownerId,
      projectId: session.projectId,
      shareOwner: session.shareOwner,
      conversationId: session.conversationId
    };
  }
}

function tailAfter(messages: MemoryExtractionMessage[], processedThroughId: string | undefined): MemoryExtractionMessage[] {
  const start = processedThroughId
    ? Math.max(0, messages.findIndex((message) => message.id === processedThroughId) + 1)
    : Math.max(0, messages.length - MAX_TAIL_MESSAGES);
  const sliced = messages.slice(start, start + MAX_TAIL_MESSAGES);
  // Keep the most recent exchange even when it alone is large, but never send
  // an unbounded transcript to the extraction model.
  let used = 0;
  let from = sliced.length;
  while (from > 0) {
    const next = sliced[from - 1];
    if (used + next.content.length > MAX_TAIL_CHARS && from < sliced.length) break;
    used += next.content.length;
    from -= 1;
  }
  return sliced.slice(from);
}

function normalizeOutput(output: MemoryExtractionOutput | null | undefined): ExtractedMemoryItem[] {
  if (!output || typeof output !== "object") return [];
  const raw = Array.isArray(output.memories) ? output.memories : [];
  const valid = raw.filter((item): item is ExtractedMemoryItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<ExtractedMemoryItem>;
    return DOMAINS.has(String(candidate.domain))
      && TYPES.has(String(candidate.type))
      && Boolean(String(candidate.subject ?? "").trim())
      && Boolean(String(candidate.value ?? "").trim());
  });
  if (raw.length > 0 && valid.length === 0) {
    // Malformed model output is not proof that nothing was worth keeping.
    throw new Error("Extractor returned only malformed memories.");
  }
  return valid;
}

function succeeded(
  processedThroughId: string,
  messages: MemoryExtractionMessage[],
  now: Date
): MemoryExtractionState {
  return {
    processedThroughId,
    revision: buildExtractionRevision(messages),
    updatedAt: now.toISOString(),
    attempts: 0
  };
}

function failed(
  previous: MemoryExtractionState | null,
  messages: MemoryExtractionMessage[],
  now: Date,
  error: string
): MemoryExtractionState {
  const attempts = (previous?.attempts ?? 0) + 1;
  const backoffMs = Math.min(60 * 60_000, 2 ** Math.min(attempts, 6) * 60_000);
  return {
    processedThroughId: previous?.processedThroughId ?? "",
    revision: buildExtractionRevision(messages),
    updatedAt: now.toISOString(),
    attempts,
    lastError: error.slice(0, 500),
    retryAfter: new Date(now.getTime() + backoffMs).toISOString()
  };
}

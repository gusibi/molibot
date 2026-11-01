import { buildExtractionRevision } from "$lib/server/sessions/sessionExtractionService.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import type { MemoryScope } from "./types.js";
import type { ExtractedMemoryItem, MemoryWriterPort } from "./memoryWriter.js";
import { normalizeSubject } from "./memoryWriter.js";
import type { MemoryExtractionState, MemoryExtractionStatePort } from "./memoryExtractionStore.js";

export interface MemoryExtractionTarget {
  ownerId: string;
  botId: string;
  agentId?: string;
  sourceScopes: MemoryScope[];
}

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
  scannedMessages: number;
  pendingReviewCandidateIds: string[];
  attempted: number;
  committed: number;
  proposals: number;
  skipped: number;
  failed: number;
  skippedBecauseInFlight: boolean;
}

export interface MemoryExtractionServiceDeps {
  listSessions: (options: { limit: number; offset: number; mode?: "idle" | "daily" }) => {
    items: MemoryExtractionSession[];
    total: number;
  };
  listMessages: (conversationId: string) => ConversationMessage[];
  store: MemoryExtractionStatePort;
  writer: MemoryWriterPort;
  extractor: MemoryExtractionExtractor;
  pendingReviewCandidates?: (sessionIds: ReadonlySet<string>) => string[];
  eligible?: (session: MemoryExtractionSession) => boolean;
  /** Import successful checkpoints from the previous daily pipeline, without modifying its store. */
  legacyWatermarks?: (session: MemoryExtractionSession) => string[];
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
  /** Bound idle model calls per sweep; daily runs drain the selected backlog. */
  maxSessionsPerSweep?: number;
  /** Idle discovery lookback; daily catch-up also visits older Sessions. */
  maxLookbackMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * Shared incremental extraction for one selected Session or all authorized
 * Sessions. Idle ticks use a bounded budget; daily runs drain the backlog.
 * Both triggers use the same checkpoint, extractor and write policy. Daily
 * requests wait for an active sweep; periodic idle ticks coalesce instead.
 */
export class MemoryExtractionService {
  private inFlight: Promise<void> | null = null;
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

  async runSweep(options: {
    conversationId?: string;
    target?: MemoryExtractionTarget;
    mode?: "idle" | "daily";
    force?: boolean;
    signal?: AbortSignal;
  } = {}): Promise<MemoryExtractionSweepResult> {
    const empty = (skippedBecauseInFlight = false): MemoryExtractionSweepResult => ({
      scanned: 0, scannedMessages: 0, pendingReviewCandidateIds: [], attempted: 0,
      committed: 0, proposals: 0, skipped: 0, failed: 0, skippedBecauseInFlight
    });
    while (this.inFlight) {
      if (options.mode !== "daily") return empty(true);
      await this.inFlight;
      options.signal?.throwIfAborted();
    }
    if (this.deps.enabled && !this.deps.enabled()) return empty();
    let release!: () => void;
    this.inFlight = new Promise<void>((resolve) => { release = resolve; });
    const result = empty();
    const daily = options.mode === "daily";
    const pending = new Set<string>();
    try {
      const now = this.now();
      const nowMs = now.getTime();
      const sessions = this.collectSessions(options.mode).filter((session) =>
        (!this.deps.eligible || this.deps.eligible(session))
        && (!options.conversationId || session.conversationId === options.conversationId)
        && (!options.target || matchesExtractionTarget(session, options.target))
      );
      result.scanned = sessions.length;
      if (daily) {
        for (const id of this.deps.pendingReviewCandidates?.(new Set(sessions.map((session) => session.conversationId))) ?? []) pending.add(id);
      }
      for (const session of sessions) {
        options.signal?.throwIfAborted();
        if (!daily && result.attempted >= this.maxSessionsPerSweep) break;
        const activity = Date.parse(session.lastActivityAt ?? session.updatedAt ?? "");
        if (!Number.isFinite(activity)) continue;
        let state = this.deps.store.get(session.conversationId);
        if (!daily && nowMs - activity > this.maxLookbackMs) continue;
        if (state?.retryAfter && Date.parse(state.retryAfter) > nowMs) {
          if (daily) result.failed += 1;
          continue;
        }
        const turns = (session.userTurnCount ?? 0) + (session.assistantTurnCount ?? 0);
        const lastExtraction = state ? Date.parse(state.updatedAt) : 0;
        const longSessionDue = turns >= 20
          && (!state || (Number.isFinite(lastExtraction) && nowMs - lastExtraction >= 10 * 60_000));
        if (!daily && !options.force && !longSessionDue && nowMs - activity < this.minIdleMs) continue;
        let messages: MemoryExtractionMessage[];
        try {
          messages = this.eligibleMessages(session.conversationId);
          if (messages.at(-1)?.role !== "assistant") continue;
          const legacy = new Set(this.deps.legacyWatermarks?.(session) ?? []);
          const legacyIndex = messages.findLastIndex((message) => legacy.has(`${message.createdAt}:${message.id}`));
          const currentIndex = messages.findIndex((message) => message.id === state?.processedThroughId);
          if (legacyIndex > currentIndex) {
            state = succeeded(messages[legacyIndex].id, messages, now);
            this.deps.store.set(session.conversationId, state);
          }
        } catch (error) {
          this.deps.store.set(session.conversationId, failed(state, [], now, error instanceof Error ? error.message : String(error)));
          result.failed += 1;
          continue;
        }
        do {
          const tail = tailAfter(messages, state?.processedThroughId);
          const last = tail.at(-1);
          if (!last) break;
          result.attempted += 1;
          result.scannedMessages += tail.length;
          try {
            const scope = this.scopeFor(session);
            const relatedMemories = await this.deps.relatedMemories?.(scope, tail) ?? [];
            const output = await this.deps.extractor({
              conversationId: session.conversationId,
              channel: session.channel,
              botId: session.botId || this.botId,
              projectId: session.projectId ?? null,
              agentId: session.agentId ?? null,
              messages: tail,
              relatedMemories
            });
            options.signal?.throwIfAborted();
            const relatedSubjects = new Set(relatedMemories.map((memory) => normalizeSubject(memory.subject)));
            const items = normalizeOutput(output).map((item) => {
              const target = item.supersedesSubject ? normalizeSubject(item.supersedesSubject) : "";
              return target && relatedSubjects.has(target) ? { ...item, subject: target } : item;
            });
            if (items.length > 0) {
              const write = await this.deps.writer.write(
                scope, items,
                tail.map((message) => ({
                  channel: session.channel, sessionId: session.conversationId,
                  conversationMessageId: message.id, observedAt: message.createdAt
                })),
                `extract:${session.conversationId}:${last.id}`
              );
              result.committed += write.committed.length;
              result.proposals += write.proposals.length;
              result.skipped += write.skipped;
              for (const id of write.proposals) pending.add(id);
              if (write.failures.length > 0) throw new Error(write.failures.join("；"));
            }
            options.signal?.throwIfAborted();
            state = succeeded(last.id, messages, now);
            this.deps.store.set(session.conversationId, state);
          } catch (error) {
            options.signal?.throwIfAborted();
            this.deps.store.set(session.conversationId, failed(state, messages, now, error instanceof Error ? error.message : String(error)));
            result.failed += 1;
            break;
          }
        } while (daily);
      }
    } finally {
      this.inFlight = null;
      release();
    }
    result.pendingReviewCandidateIds = [...pending];
    if (result.attempted > 0) {
      this.deps.log?.(`extraction sweep scanned=${result.scanned} attempted=${result.attempted} committed=${result.committed} proposals=${result.proposals} skipped=${result.skipped} failed=${result.failed}`);
    }
    return result;
  }

  private collectSessions(mode?: "idle" | "daily"): MemoryExtractionSession[] {
    const collected: MemoryExtractionSession[] = [];
    const pageSize = 100;
    let offset = 0;
    for (;;) {
      const page = this.deps.listSessions({ limit: pageSize, offset, mode });
      collected.push(...page.items);
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total) break;
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
  const firstReply = messages.findIndex((message, index) => index >= start && message.role === "assistant");
  const sliced = messages.slice(start, Math.max(start + MAX_TAIL_MESSAGES, firstReply + 1));
  let used = 0;
  let end = 0;
  let completedEnd = 0;
  for (const message of sliced) {
    if (used + message.content.length > MAX_TAIL_CHARS && completedEnd > 0) break;
    used += message.content.length;
    end += 1;
    if (message.role === "assistant") completedEnd = end;
  }
  // Advance through a contiguous completed range, never past an unsent batch.
  return sliced.slice(0, completedEnd);
}

function normalizeOutput(output: MemoryExtractionOutput | null | undefined): ExtractedMemoryItem[] {
  if (!output || typeof output !== "object"
    || (!Array.isArray(output.memories) && output.noUsefulInformation !== true)) {
    throw new Error("Extractor returned malformed output.");
  }
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


export function matchesExtractionTarget(session: MemoryExtractionSession, target: MemoryExtractionTarget): boolean {
  if (target.agentId && session.agentId !== target.agentId) return false;
  return target.sourceScopes.some((scope) => scope.projectId
    ? session.projectId === scope.projectId
    : !session.projectId && session.botId === target.botId && session.channel === scope.channel
      && session.ownerExternalUserId === scope.externalUserId);
}

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { Channel, ConversationMessage } from "$lib/shared/types/message.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { MemoryScope } from "$lib/server/memory/types.js";
import type { MemoryGateway } from "./gateway.js";
import type { MemoryExtractionService, MemoryExtractionTarget } from "./memoryExtraction.js";
import { decodeExternalSessionId, listExternalSessionsFromContexts, readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";

export interface ReflectionSourceScope extends MemoryScope {
  projectId?: string;
}

export interface ReflectionTarget extends MemoryExtractionTarget {
  timezone: string;
}

export interface ReflectionMessage extends ConversationMessage {
  channel: string;
  sessionId: string;
}

export interface ReflectionSourceProjection {
  scope: ReflectionSourceScope;
  conversationId: string;
  messages: ReflectionMessage[];
  latestSummary?: string;
  watermark?: string;
}

export interface ReflectionSourceReader {
  read(target: ReflectionTarget, localDate: string): Promise<ReflectionSourceProjection[]>;
}

type WatermarkRow = { watermark: string };

export class ReflectionStateStore {
  private readonly db: DatabaseSync;
  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_reflection_watermarks (
      target_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      watermark TEXT NOT NULL,
      run_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(target_id, conversation_id)
    )`);
  }
  get(targetId: string, conversationId: string): string | undefined {
    return (this.db.prepare("SELECT watermark FROM memory_reflection_watermarks WHERE target_id = ? AND conversation_id = ?")
      .get(targetId, conversationId) as WatermarkRow | undefined)?.watermark;
  }
  set(targetId: string, conversationId: string, watermark: string, runKey: string): void {
    this.db.prepare(`INSERT INTO memory_reflection_watermarks
      (target_id, conversation_id, watermark, run_key, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_id, conversation_id) DO UPDATE SET watermark = excluded.watermark, run_key = excluded.run_key, updated_at = excluded.updated_at`)
      .run(targetId, conversationId, watermark, runKey, new Date().toISOString());
  }
  close(): void { this.db.close(); }
}

function canonicalScopes(scopes: ReflectionSourceScope[]): string[] {
  return scopes.map((scope) => [scope.channel, scope.externalUserId, scope.projectId ?? ""].map(encodeURIComponent).join(":"))
    .sort();
}

export function reflectionTargetId(target: ReflectionTarget): string {
  return createHash("sha256").update(JSON.stringify([
    target.ownerId,
    target.botId,
    target.agentId,
    target.timezone,
    canonicalScopes(target.sourceScopes)
  ])).digest("hex");
}

export function reflectionLocalDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function previousReflectionLocalDate(now: Date, timezone: string): string {
  const [year, month, day] = reflectionLocalDate(now, timezone).split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

function dateInTimezone(value: string, timezone: string): string {
  return reflectionLocalDate(new Date(value), timezone);
}

export class SessionReflectionSourceReader implements ReflectionSourceReader {
  private readonly isExcluded: (conversationId: string) => boolean;

  constructor(
    private readonly sessions: SessionStore,
    private readonly state: ReflectionStateStore,
    private readonly summaryReader?: (conversationId: string) => string | undefined,
    private readonly externalDataRoot?: string,
    private readonly targetIdOf: (target: ReflectionTarget) => string = reflectionTargetId,
    isExcluded?: (conversationId: string) => boolean
  ) {
    // Trashed sessions are excluded from reflection/extraction inputs: their
    // search projection is already gone and their transcript is pending
    // expiry. The production wiring passes a lifecycle-state check here.
    this.isExcluded = isExcluded ?? (() => false);
  }

  private excluded(conversationId: string): boolean {
    try {
      return this.isExcluded(conversationId);
    } catch {
      // Fail open: a broken exclusion check must not hide live sessions from
      // reflection; trash still hides via the search-projection removal.
      return false;
    }
  }

  async read(target: ReflectionTarget, localDate: string): Promise<ReflectionSourceProjection[]> {
    const targetId = this.targetIdOf(target);
    const projections: ReflectionSourceProjection[] = [];
    for (const scope of target.sourceScopes) {
      const authorizedSources = listAuthorizedConversationSources({
        botId: target.botId,
        channel: scope.channel,
        chatId: scope.externalUserId,
        projectId: scope.projectId
      });
      if (!scope.projectId && scope.channel !== "web" && this.externalDataRoot) {
        const entries = listExternalSessionsFromContexts(this.externalDataRoot, authorizedSources).filter((entry) => {
          const ref = decodeExternalSessionId(entry.conversation.id);
          return ref?.channel === scope.channel && ref.botId === target.botId && ref.chatId === scope.externalUserId;
        });
        for (const entry of entries) {
          if (this.excluded(entry.conversation.id)) continue;
          if (target.agentId && entry.conversation.agentId !== target.agentId) continue;
          const transcript = readExternalTranscriptFromContexts(this.externalDataRoot, entry.conversation.id);
          if (!transcript) continue;
          const watermark = this.state.get(targetId, entry.conversation.id);
          const messages = transcript.messages
            .filter((message) => retentionCapabilities(message.retention).memoryEligible)
            .filter((message) => dateInTimezone(message.createdAt, target.timezone) === localDate)
            .filter((message) => !watermark || `${message.createdAt}:${message.id}` > watermark)
            .map((message) => ({ ...message, channel: scope.channel, sessionId: entry.conversation.id }));
          if (messages.length > 0) projections.push({ scope, conversationId: entry.conversation.id, messages, watermark });
        }
        continue;
      }
      const conversations = scope.projectId
        ? this.sessions.listProjectConversations(scope.projectId)
        : this.sessions.listConversations(scope.channel as Channel, scope.externalUserId);
      for (const conversation of conversations) {
        if (this.excluded(conversation.id)) continue;
        if (!conversation.projectId && target.agentId && conversation.agentId !== target.agentId) continue;
        const watermark = this.state.get(targetId, conversation.id);
        const messages = this.sessions.listMessages(conversation.id)
          .filter((message) => retentionCapabilities(message.retention).memoryEligible)
          .filter((message) => dateInTimezone(message.createdAt, target.timezone) === localDate)
          .filter((message) => !watermark || `${message.createdAt}:${message.id}` > watermark)
          .map((message) => ({ ...message, channel: scope.channel, sessionId: conversation.id }));
        if (messages.length === 0) continue;
        projections.push({
          scope,
          conversationId: conversation.id,
          messages,
          latestSummary: this.summaryReader?.(conversation.id),
          watermark
        });
      }
    }
    return projections;
  }

  // Earliest local calendar day with any activity across the target's scopes.
  // Used by the daily-materials backfill to pick a start date that covers the
  // full history. Ignores watermarks — this is a raw scan of stored messages.
  earliestLocalDate(target: ReflectionTarget): string | undefined {
    let earliest: string | undefined;
    const consider = (createdAt: string) => {
      const day = dateInTimezone(createdAt, target.timezone);
      if (!earliest || day < earliest) earliest = day;
    };
    for (const scope of target.sourceScopes) {
      if (!scope.projectId && scope.channel !== "web" && this.externalDataRoot) {
        const entries = listExternalSessionsFromContexts(this.externalDataRoot).filter((entry) => {
          const ref = decodeExternalSessionId(entry.conversation.id);
          return ref?.channel === scope.channel && ref.botId === target.botId && ref.chatId === scope.externalUserId;
        });
        for (const entry of entries) {
          if (this.excluded(entry.conversation.id)) continue;
          if (target.agentId && entry.conversation.agentId !== target.agentId) continue;
          const transcript = readExternalTranscriptFromContexts(this.externalDataRoot, entry.conversation.id);
          for (const message of transcript?.messages ?? []) consider(message.createdAt);
        }
        continue;
      }
      const conversations = scope.projectId
        ? this.sessions.listProjectConversations(scope.projectId)
        : this.sessions.listConversations(scope.channel as Channel, scope.externalUserId);
      for (const conversation of conversations) {
        if (this.excluded(conversation.id)) continue;
        if (!conversation.projectId && target.agentId && conversation.agentId !== target.agentId) continue;
        for (const message of this.sessions.listMessages(conversation.id)) consider(message.createdAt);
      }
    }
    return earliest;
  }
}

export interface ReflectionRunResult {
  targetId: string;
  runKey: string;
  localDate: string;
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
  committedMemories: number;
  pendingReviewCandidateIds: string[];
}

/** Daily scheduling adapter over the same incremental pipeline used by idle Sessions. */
export async function runMemoryReflection(
  extraction: MemoryExtractionService,
  options: { timezone: string; target?: ReflectionTarget; now?: Date; signal?: AbortSignal }
): Promise<ReflectionRunResult> {
  const localDate = reflectionLocalDate(options.now ?? new Date(), options.timezone);
  const targetId = options.target ? reflectionTargetId(options.target) : "owner";
  const result = await extraction.runSweep({ mode: "daily", target: options.target, signal: options.signal });
  const outcome = {
    targetId, runKey: `${targetId}:${localDate}`, localDate,
    scannedConversations: result.scanned,
    scannedMessages: result.scannedMessages,
    createdCandidates: result.proposals,
    committedMemories: result.committed,
    pendingReviewCandidateIds: result.pendingReviewCandidateIds
  };
  if (result.failed > 0) throw new MemoryReflectionError(result.failed, outcome);
  return outcome;
}

export class MemoryReflectionError extends Error {
  constructor(readonly failedSessions: number, readonly result: ReflectionRunResult) {
    super(`Memory extraction failed or is backing off for ${failedSessions} Session(s).`);
    this.name = "MemoryReflectionError";
  }
}


/** Pending proposals can originate from idle extraction; transcript progress must not hide them from daily review. */
export function pendingMemoryReviewCandidates(
  memory: Pick<MemoryGateway, "listCandidates">,
  sessionIds: ReadonlySet<string>
): string[] {
  const ids = new Set<string>();
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const page = memory.listCandidates("pending", limit, offset);
    for (const candidate of page) {
      if (candidate.sources.some((source) => source.sessionId && sessionIds.has(source.sessionId))) ids.add(candidate.id);
    }
    if (page.length < limit) break;
  }
  return [...ids];
}

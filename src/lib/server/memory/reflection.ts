import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { Channel, ConversationMessage } from "$lib/shared/types/message.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { MemoryCandidateCreateInput, MemoryRecord, MemoryScope } from "$lib/server/memory/types.js";
import { MemoryCandidateValidationError, type MemoryGateway } from "$lib/server/memory/gateway.js";
import { agentNamespace, chatNamespace, contentNamespace, ownerNamespace, projectNamespace } from "$lib/server/memory/namespaces.js";
import { decodeExternalSessionId, listExternalSessionsFromContexts, readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";

export interface ReflectionSourceScope extends MemoryScope {
  projectId?: string;
}

export interface ReflectionTarget {
  ownerId: string;
  botId: string;
  timezone: string;
  sourceScopes: ReflectionSourceScope[];
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

export interface ReflectionExtractor {
  extract(input: {
    target: ReflectionTarget;
    runKey: string;
    localDate: string;
    projection: ReflectionSourceProjection;
    relatedMemories: ReflectionRelatedMemory[];
    signal?: AbortSignal;
  }): Promise<ReflectionExtractedCandidate[]>;
}

export interface ReflectionRelatedMemory {
  ref: `R${number}`;
  namespace: NonNullable<MemoryRecord["namespace"]>;
  domain: NonNullable<MemoryRecord["domain"]>;
  type: NonNullable<MemoryRecord["type"]>;
  subject: string;
  path: string;
  summary: string;
  record: MemoryRecord;
}

export type ReflectionExtractedCandidate = Omit<MemoryCandidateCreateInput, "runKey" | "fingerprint" | "sources" | "path"> & {
  sources?: MemoryCandidateCreateInput["sources"];
  path?: string;
  supersedesRef?: string;
  disputesRef?: string;
};

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
  constructor(
    private readonly sessions: SessionStore,
    private readonly state: ReflectionStateStore,
    private readonly summaryReader?: (conversationId: string) => string | undefined,
    private readonly externalDataRoot?: string,
    private readonly targetIdOf: (target: ReflectionTarget) => string = reflectionTargetId
  ) {}

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
          const transcript = readExternalTranscriptFromContexts(this.externalDataRoot, entry.conversation.id);
          if (!transcript) continue;
          const watermark = this.state.get(targetId, entry.conversation.id);
          const messages = transcript.messages
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
        const watermark = this.state.get(targetId, conversation.id);
        const messages = this.sessions.listMessages(conversation.id)
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
          const transcript = readExternalTranscriptFromContexts(this.externalDataRoot, entry.conversation.id);
          for (const message of transcript?.messages ?? []) consider(message.createdAt);
        }
        continue;
      }
      const conversations = scope.projectId
        ? this.sessions.listProjectConversations(scope.projectId)
        : this.sessions.listConversations(scope.channel as Channel, scope.externalUserId);
      for (const conversation of conversations) {
        for (const message of this.sessions.listMessages(conversation.id)) consider(message.createdAt);
      }
    }
    return earliest;
  }
}

export interface ReflectionRunResult {
  targetId: string;
  runKey: string;
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
}

export class MemoryReflectionService {
  constructor(
    private readonly gateway: MemoryGateway,
    private readonly reader: ReflectionSourceReader,
    private readonly state: ReflectionStateStore,
    private readonly extractor: ReflectionExtractor
  ) {}

  async run(target: ReflectionTarget, options: { now?: Date; signal?: AbortSignal } = {}): Promise<ReflectionRunResult> {
    const localDate = previousReflectionLocalDate(options.now ?? new Date(), target.timezone);
    const targetId = reflectionTargetId(target);
    const runKey = `${targetId}:${localDate}`;
    const projections = await this.reader.read(target, localDate);
    let scannedMessages = 0;
    let createdCandidates = 0;
    for (const projection of projections) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Reflection aborted.");
      scannedMessages += projection.messages.length;
      const query = projection.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n").slice(0, 4_000);
      const relatedRows = await this.gateway.search({
        ...projection.scope,
        ownerId: target.ownerId,
        botId: target.botId
      }, { query, mode: "hybrid", limit: 12 });
      const relatedMemories: ReflectionRelatedMemory[] = relatedRows
        .filter((record): record is MemoryRecord & { namespace: NonNullable<MemoryRecord["namespace"]>; domain: NonNullable<MemoryRecord["domain"]>; type: NonNullable<MemoryRecord["type"]>; subject: string; path: string } =>
          Boolean(record.namespace && record.domain && record.type && record.subject && record.path)
        )
        .map((record, index) => ({
          ref: `R${index + 1}` as const,
          namespace: record.namespace,
          domain: record.domain,
          type: record.type,
          subject: record.subject,
          path: record.path,
          summary: record.content.replace(/\s+/g, " ").trim().slice(0, 180),
          record
        }));
      const relatedByRef = new Map(relatedMemories.map((memory) => [memory.ref, memory]));
      const extracted = await this.extractor.extract({ target, runKey, localDate, projection, relatedMemories, signal: options.signal });
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Reflection aborted.");
      for (const item of extracted) {
        const relationRef = item.supersedesRef || item.disputesRef;
        const related = relationRef ? relatedByRef.get(relationRef as `R${number}`) : undefined;
        if (relationRef && !related) continue;
        if (item.supersedesRef && related && item.type !== related.type) continue;
        const equivalent = relatedMemories.find((memory) => memory.record.content.replace(/\s+/g, " ").trim().toLocaleLowerCase() === item.value.replace(/\s+/g, " ").trim().toLocaleLowerCase());
        if (equivalent) {
          // Same durable fact mentioned again: reinforce the confirmed memory
          // instead of silently dropping the repetition. Best-effort — a failed
          // reinforcement must not block sibling candidates or the watermark.
          try {
            await this.gateway.reinforceMemory({ ...projection.scope, ownerId: target.ownerId, botId: target.botId }, equivalent.record.id);
          } catch {
            // ignore
          }
          continue;
        }
        const sourceMessages = projection.messages.filter((message) =>
          message.role === "user" || (item.type === "skill" && message.role === "assistant")
        );
        // Source identity is runtime-owned evidence. Never trust an extractor to
        // invent a message id or claim a successful execution from another run.
        const sources = sourceMessages.map((message) => ({
          channel: message.channel,
          sessionId: message.sessionId,
          conversationMessageId: message.id,
          platformMessageId: message.platformMessageId,
          observedAt: message.createdAt
        }));
        try {
          const candidate = item.supersedesRef && related ? {
            ...item,
            namespace: related.namespace,
            domain: related.domain,
            type: related.type,
            subject: related.subject,
            path: related.path,
            supersedesMemoryId: related.record.id
          } : item.disputesRef && related ? { ...item, disputesMemoryId: related.record.id } : item;
          const { supersedesRef: _supersedesRef, disputesRef: _disputesRef, ...candidateInput } = candidate;
          const created = this.gateway.createCandidate({
            ...candidateInput,
            path: candidateInput.path || `mory://${candidateInput.type}/${candidateInput.subject}`,
            runKey,
            sources
          });
          if (created) {
            createdCandidates += 1;
            await this.gateway.maybeAutoConfirmCandidate(created.id);
          }
        } catch (cause) {
          // LLM extraction is untrusted; one malformed candidate must not block
          // valid siblings or replay the whole projection on the next run.
          if (!(cause instanceof MemoryCandidateValidationError)) throw cause;
        }
      }
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Reflection aborted.");
      const last = projection.messages.at(-1);
      if (last) this.state.set(targetId, projection.conversationId, `${last.createdAt}:${last.id}`, runKey);
    }
    return { targetId, runKey, scannedConversations: projections.length, scannedMessages, createdCandidates };
  }
}

export function recommendedCandidateNamespace(target: ReflectionTarget, scope: ReflectionSourceScope, domain: MemoryCandidateCreateInput["domain"]): MemoryCandidateCreateInput["namespace"] {
  if (domain === "owner") return ownerNamespace(target.ownerId);
  if (domain === "project") return projectNamespace({ ...scope, ownerId: target.ownerId }) ?? chatNamespace(scope);
  if (domain === "agent_self") return agentNamespace(target.botId);
  return contentNamespace(target.botId);
}

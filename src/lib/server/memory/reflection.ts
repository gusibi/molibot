import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { Channel, ConversationMessage } from "$lib/shared/types/message.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { MemoryCandidateCreateInput, MemoryScope } from "$lib/server/memory/types.js";
import { MemoryCandidateValidationError, type MemoryGateway } from "$lib/server/memory/gateway.js";
import { agentNamespace, chatNamespace, contentNamespace, ownerNamespace, projectNamespace } from "$lib/server/memory/namespaces.js";
import { decodeExternalSessionId, listExternalSessionsFromContexts, readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";

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
    signal?: AbortSignal;
  }): Promise<Array<Omit<MemoryCandidateCreateInput, "runKey" | "fingerprint" | "sources"> & { sources?: MemoryCandidateCreateInput["sources"] }>>;
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
      if (!scope.projectId && scope.channel !== "web" && this.externalDataRoot) {
        const entries = listExternalSessionsFromContexts(this.externalDataRoot).filter((entry) => {
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
      const extracted = await this.extractor.extract({ target, runKey, localDate, projection, signal: options.signal });
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Reflection aborted.");
      for (const item of extracted) {
        const sources = item.sources?.length ? item.sources : projection.messages.filter((message) => message.role === "user").map((message) => ({
          channel: message.channel,
          sessionId: message.sessionId,
          conversationMessageId: message.id,
          platformMessageId: message.platformMessageId
        }));
        try {
          const created = this.gateway.createCandidate({ ...item, runKey, sources });
          if (created) createdCandidates += 1;
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

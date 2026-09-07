import type { SessionStore } from "$lib/server/sessions/store.js";
import type { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import type { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import type { SessionExtractionStore, ExtractionDocRef } from "$lib/server/sessions/sessionExtractionStore.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";
import { MemoryCandidateValidationError } from "$lib/server/memory/gateway.js";
import { agentNamespace, contentNamespace, ownerNamespace, projectNamespace } from "$lib/server/memory/namespaces.js";
import type {
  MemoryCandidate,
  MemoryCandidateCreateInput,
  MemoryDomain,
  MemoryNamespace,
  MemorySemanticType
} from "$lib/server/memory/types.js";

export type SessionExtractionStatus =
  | "unprocessed"
  | "processing"
  | "saved"
  | "no-useful-information"
  | "pending-review"
  | "partially-processed"
  | "failed";

export interface ExtractionMemoryProposal {
  domain: MemoryDomain;
  type: MemorySemanticType;
  subject: string;
  value: string;
  confidence?: number;
  reason?: string;
}

export interface ExtractionArtifactLink {
  artifactId: string;
  title?: string;
}

export interface ExtractionArtifactSave {
  title: string;
  content: string;
}

export interface ExtractionOutput {
  noUsefulInformation?: boolean;
  memories?: ExtractionMemoryProposal[];
  artifactLinks?: ExtractionArtifactLink[];
  artifactSaves?: ExtractionArtifactSave[];
}

export interface ExtractionSourceMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export type SessionExtractionExtractor = (input: {
  conversationId: string;
  channel: string;
  sessionId: string;
  projectId: string | null;
  ownerExternalUserId: string | null;
  botId: string;
  /** Only Turn-Retention-eligible turns. Restricted turns never reach the extractor. */
  messages: ExtractionSourceMessage[];
}) => Promise<ExtractionOutput | null | undefined>;

/** Reuses the existing artifact/document capabilities; tests inject a recording stub. */
export interface SessionExtractionDocumentSaver {
  save(input: { conversationId: string; title: string; content: string }): Promise<{ docId: string }>;
}

/**
 * Narrow gateway seam over {@link MemoryGateway}: validation, duplicate
 * suppression and the approval/review policy stay on the gateway side. This
 * service only routes namespaces, filters retention-restricted turns and
 * records durable receipts — pending candidates are never treated as saved.
 */
export interface SessionExtractionGateway {
  createCandidate(input: MemoryCandidateCreateInput): MemoryCandidate | null;
  maybeAutoConfirmCandidate(id: string): Promise<MemoryCandidate | null>;
  getCandidate?(id: string): MemoryCandidate | null;
  isPrivacySuppressed?(
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">
  ): boolean;
}

type SessionsPort = Pick<
  SessionStore,
  | "getWebConversationOwner"
  | "getConversationById"
  | "getConversationProjectId"
  | "getProjectConversation"
  | "listMessages"
>;

export interface SessionExtractionServiceDeps {
  sessions: SessionsPort;
  lifecycle: SessionLifecycleService;
  lifecycleRows: SessionLifecycleStore;
  store: SessionExtractionStore;
  gateway: SessionExtractionGateway;
  extractor: SessionExtractionExtractor;
  documentSaver?: SessionExtractionDocumentSaver;
  ownerId?: string;
  botId?: string;
}

export interface SessionExtractionResult {
  conversationId: string;
  status: SessionExtractionStatus;
  /** Source revision captured at job start; later messages change it and read back as partial. */
  messageRevision: string;
  processedThroughId: string | null;
  savedMemoryIds: string[];
  savedDocRefs: ExtractionDocRef[];
  pendingCandidateIds: string[];
  failureReasons: string[];
}

export interface ExtractAndArchiveResult extends SessionExtractionResult {
  archived: boolean;
  archiveReason?: string;
}

const DOMAINS: MemoryDomain[] = ["owner", "project", "agent_self", "content"];
const TYPES: MemorySemanticType[] = ["user_preference", "user_fact", "skill", "event", "task", "world_knowledge"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Shared application-layer Session extraction. Channel adapters never own
 * this: source identity and message revision are captured at job start,
 * receipts persist processed-through progress plus result references, and
 * extract-and-archive only archives through {@link SessionLifecycleService}
 * when every eligible item is processed, required outputs are saved, nothing
 * awaits review and the source is unchanged. Extraction never deletes.
 */
export class SessionExtractionService {
  private readonly sessions: SessionsPort;
  private readonly lifecycle: SessionLifecycleService;
  private readonly lifecycleRows: SessionLifecycleStore;
  private readonly store: SessionExtractionStore;
  private readonly gateway: SessionExtractionGateway;
  private readonly extractor: SessionExtractionExtractor;
  private readonly documentSaver?: SessionExtractionDocumentSaver;
  private readonly ownerId: string;
  private readonly botId: string;

  constructor(deps: SessionExtractionServiceDeps) {
    this.sessions = deps.sessions;
    this.lifecycle = deps.lifecycle;
    this.lifecycleRows = deps.lifecycleRows;
    this.store = deps.store;
    this.gateway = deps.gateway;
    this.extractor = deps.extractor;
    this.documentSaver = deps.documentSaver;
    this.ownerId = deps.ownerId ?? "owner";
    this.botId = deps.botId ?? "web";
  }

  getStatus(input: { conversationId: string; requesterExternalUserId?: string }): {
    status: SessionExtractionStatus;
    conversationId: string;
  } {
    const id = String(input.conversationId ?? "").trim();
    const located = this.locate(id, input.requesterExternalUserId);
    if (!located) return { status: "unprocessed", conversationId: id };
    const receipt = this.store.get(id);
    if (!receipt) return { status: "unprocessed", conversationId: id };
    // Later messages make the Session partially processed again, regardless
    // of what the previous run concluded.
    if (receipt.messageRevision !== this.revisionOf(id)) {
      return { status: "partially-processed", conversationId: id };
    }
    return { status: receipt.status, conversationId: id };
  }

  async extract(input: { conversationId: string; requesterExternalUserId?: string }): Promise<SessionExtractionResult> {
    const id = String(input.conversationId ?? "").trim();
    const located = this.locate(id, input.requesterExternalUserId);
    if (!located) {
      return this.emptyResult(id, "failed", ["Session not found or unauthorized."]);
    }
    if (this.lifecycleRows.get(id)?.state === "trashed") {
      return this.emptyResult(id, "failed", ["Trashed sessions are excluded from extraction inputs."]);
    }
    const startRevision = this.revisionOf(id);

    // Receipt idempotency: a completed revision never re-runs the extractor
    // or re-creates candidates, so retries stay duplicate-free.
    const existing = this.store.get(id);
    if (existing && existing.messageRevision === startRevision && (existing.status === "saved" || existing.status === "no-useful-information")) {
      return this.toResult(existing);
    }

    const all = this.sessions
      .listMessages(id)
      .filter((message) => message.role === "user" || message.role === "assistant");
    // Same eligible predicate as the daily reflection source reader; a
    // previous reflection run never counts as proof this Session was handled.
    const eligible = all.filter((message) => retentionCapabilities(message.retention).memoryEligible);
    const eligibleMessages: ExtractionSourceMessage[] = eligible.map((message) => ({
      id: message.id,
      role: message.role,
      content: typeof message.content === "string" ? message.content : "",
      createdAt: message.createdAt
    }));
    const lastEligible = eligible.at(-1);
    const runKey = `extract:${id}:${startRevision}`;

    let output: ExtractionOutput | null | undefined;
    try {
      output = await this.extractor({
        conversationId: id,
        channel: located.channel,
        sessionId: id,
        projectId: located.projectId,
        ownerExternalUserId: located.ownerExternalUserId,
        botId: this.botId,
        messages: eligibleMessages
      });
    } catch (error) {
      return this.persist({
        conversationId: id,
        channel: located.channel,
        projectId: located.projectId,
        ownerExternalUserId: located.ownerExternalUserId,
        messageRevision: startRevision,
        processedThroughId: lastEligible?.id ?? null,
        processedThroughAt: lastEligible?.createdAt ?? null,
        status: "failed",
        runKey,
        failureReasons: [`Extractor failed: ${error instanceof Error ? error.message : String(error)}`]
      });
    }

    // An empty or malformed model response is never proof of
    // nothing-to-save; only an explicit no-useful-information claim qualifies.
    if (!isRecord(output)) {
      return this.persist({
        conversationId: id,
        channel: located.channel,
        projectId: located.projectId,
        ownerExternalUserId: located.ownerExternalUserId,
        messageRevision: startRevision,
        processedThroughId: lastEligible?.id ?? null,
        processedThroughAt: lastEligible?.createdAt ?? null,
        status: "failed",
        runKey,
        failureReasons: ["Extractor returned no usable output."]
      });
    }
    const memories = Array.isArray(output.memories) ? output.memories : [];
    const artifactLinks = Array.isArray(output.artifactLinks) ? output.artifactLinks : [];
    const artifactSaves = Array.isArray(output.artifactSaves) ? output.artifactSaves : [];
    if (output.noUsefulInformation === true && memories.length === 0 && artifactLinks.length === 0 && artifactSaves.length === 0) {
      return this.persist({
        conversationId: id,
        channel: located.channel,
        projectId: located.projectId,
        ownerExternalUserId: located.ownerExternalUserId,
        messageRevision: startRevision,
        processedThroughId: lastEligible?.id ?? null,
        processedThroughAt: lastEligible?.createdAt ?? null,
        status: "no-useful-information",
        runKey
      });
    }

    const savedMemoryIds: string[] = [];
    const savedDocRefs: ExtractionDocRef[] = [];
    const pendingCandidateIds: string[] = [];
    const failureReasons: string[] = [];
    let suppressedCount = 0;

    const sources = eligibleMessages.map((message) => ({
      channel: located.channel,
      sessionId: id,
      conversationMessageId: message.id,
      observedAt: message.createdAt
    }));

    for (const proposal of memories) {
      const problem = this.checkProposal(proposal, located.projectId);
      if (problem) {
        failureReasons.push(problem);
        continue;
      }
      const item = proposal as ExtractionMemoryProposal;
      let namespace: MemoryNamespace;
      try {
        namespace = this.namespaceFor(item.domain, located.projectId);
      } catch (error) {
        failureReasons.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      const candidateInput: MemoryCandidateCreateInput = {
        namespace,
        domain: item.domain,
        type: item.type,
        subject: String(item.subject).trim(),
        path: `mory://${item.type}/${String(item.subject).trim()}`,
        value: String(item.value),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
        reason: typeof item.reason === "string" && item.reason.trim() ? item.reason : "session-extract",
        sources,
        layer: "long_term",
        runKey
      };
      // Honor memory deletion suppression: cleanup must never recreate a
      // forgotten item, and a suppressed item is handled, not failed.
      if (this.gateway.isPrivacySuppressed?.(candidateInput)) {
        suppressedCount += 1;
        continue;
      }
      let created: MemoryCandidate | null;
      try {
        created = this.gateway.createCandidate(candidateInput);
      } catch (error) {
        failureReasons.push(
          error instanceof MemoryCandidateValidationError || error instanceof Error
            ? error.message
            : String(error)
        );
        continue;
      }
      if (!created) {
        // Duplicate of an already-saved candidate: receipt-level idempotency,
        // safe to treat as handled without recording a second reference.
        continue;
      }
      const final = await this.gateway.maybeAutoConfirmCandidate(created.id);
      if (!final) {
        failureReasons.push(`Candidate confirmation unavailable for ${item.subject}.`);
        continue;
      }
      if (final.status === "pending") {
        pendingCandidateIds.push(final.id);
      } else if (final.confirmedMemoryId) {
        savedMemoryIds.push(final.confirmedMemoryId);
      } else {
        pendingCandidateIds.push(final.id);
      }
    }

    for (const link of artifactLinks) {
      if (!isRecord(link) || !String(link.artifactId ?? "").trim()) {
        failureReasons.push("Malformed artifact link: artifactId is required.");
        continue;
      }
      // Complete independently saved artifacts are linked, never recopied
      // into a memory summary.
      savedDocRefs.push({ docId: String(link.artifactId).trim(), title: typeof link.title === "string" ? link.title : undefined });
    }

    for (const save of artifactSaves) {
      if (!isRecord(save) || !String(save.title ?? "").trim() || !String(save.content ?? "").trim()) {
        failureReasons.push("Malformed artifact save: title and content are required.");
        continue;
      }
      // A transcript-only result earns preservation only after an authorized
      // independent document exists; never claim it from the transcript alone.
      if (!this.documentSaver) {
        failureReasons.push(`No authorized document saver for artifact "${String(save.title).trim()}".`);
        continue;
      }
      try {
        const saved = await this.documentSaver.save({
          conversationId: id,
          title: String(save.title).trim(),
          content: String(save.content)
        });
        savedDocRefs.push({ docId: saved.docId, title: String(save.title).trim() });
      } catch (error) {
        failureReasons.push(`Artifact save failed for "${String(save.title).trim()}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // A failed sibling never erases already-saved results, and it never
    // completes the Session: failures outrank pending outrank saved.
    const status =
      failureReasons.length > 0 ? "failed"
      : pendingCandidateIds.length > 0 ? "pending-review"
      : "saved";
    if (status === "saved" && savedMemoryIds.length === 0 && savedDocRefs.length === 0 && suppressedCount === 0) {
      return this.persist({
        conversationId: id,
        channel: located.channel,
        projectId: located.projectId,
        ownerExternalUserId: located.ownerExternalUserId,
        messageRevision: startRevision,
        processedThroughId: lastEligible?.id ?? null,
        processedThroughAt: lastEligible?.createdAt ?? null,
        status: "failed",
        runKey,
        savedMemoryIds,
        savedDocRefs,
        failureReasons: ["Extractor returned no usable output."]
      });
    }
    return this.persist({
      conversationId: id,
      channel: located.channel,
      projectId: located.projectId,
      ownerExternalUserId: located.ownerExternalUserId,
      messageRevision: startRevision,
      processedThroughId: lastEligible?.id ?? null,
      processedThroughAt: lastEligible?.createdAt ?? null,
      status,
      runKey,
      savedMemoryIds,
      savedDocRefs,
      pendingCandidateIds,
      failureReasons,
      suppressedCount
    });
  }

  async extractAndArchive(input: {
    conversationId: string;
    requesterExternalUserId?: string;
  }): Promise<ExtractAndArchiveResult> {
    const id = String(input.conversationId ?? "").trim();
    const located = this.locate(id, input.requesterExternalUserId);
    if (!located) {
      return { ...this.emptyResult(id, "failed", ["Session not found or unauthorized."]), archived: false, archiveReason: "not-found" };
    }
    const startVersion = this.lifecycleRows.get(id)?.version ?? null;
    const startRevision = this.revisionOf(id);
    const result = await this.extract(input);
    if (result.status !== "saved" && result.status !== "no-useful-information") {
      return {
        ...result,
        archived: false,
        archiveReason: result.status === "pending-review" ? "pending-review" : "extraction-failed"
      };
    }
    // Archive gate: every eligible item processed, required outputs saved,
    // nothing awaiting review, and the source version unchanged. Concurrent
    // messages, failures and pending review leave the Session unarchived.
    if (this.revisionOf(id) !== result.messageRevision || this.revisionOf(id) !== startRevision) {
      return { ...result, archived: false, archiveReason: "concurrent-messages: source changed during extraction" };
    }
    if (startVersion !== null && this.lifecycleRows.get(id)?.version !== startVersion) {
      return { ...result, archived: false, archiveReason: "version-changed: lifecycle moved during extraction" };
    }
    const outcome = this.lifecycle.archive({ conversationId: id, requesterExternalUserId: input.requesterExternalUserId });
    if (outcome.status !== "succeeded") {
      const reason = outcome.status === "skipped" ? `archive-skipped: ${outcome.reason}` : `archive-failed: ${outcome.reason}`;
      return { ...result, archived: false, archiveReason: reason };
    }
    return { ...result, archived: true };
  }

  private locate(
    conversationId: string,
    requesterExternalUserId?: string
  ): { channel: string; projectId: string | null; ownerExternalUserId: string | null } | null {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const owner = this.sessions.getWebConversationOwner(id);
    if (owner) {
      if (requesterExternalUserId !== undefined && owner !== requesterExternalUserId) return null;
      const conversation = this.sessions.getConversationById(id, "web", owner);
      if (!conversation) return null;
      return { channel: "web", projectId: null, ownerExternalUserId: owner };
    }
    const projectId = this.sessions.getConversationProjectId(id);
    if (projectId) {
      const conversation = this.sessions.getProjectConversation(projectId, id);
      if (!conversation) return null;
      return { channel: "web", projectId, ownerExternalUserId: null };
    }
    return null;
  }

  private revisionOf(conversationId: string): string {
    const all = this.sessions
      .listMessages(conversationId)
      .filter((message) => message.role === "user" || message.role === "assistant");
    const last = all.at(-1);
    return `${all.length}:${last?.id ?? "empty"}:${last?.createdAt ?? ""}`;
  }

  private namespaceFor(domain: MemoryDomain, projectId: string | null): MemoryNamespace {
    if (domain === "owner") return ownerNamespace(this.ownerId);
    // Project facts and decisions remain Project-scoped, never owner-scoped.
    if (domain === "project") {
      if (!projectId) throw new Error("Project-scoped facts require a Project session.");
      const namespace = projectNamespace({ channel: "web", externalUserId: "", ownerId: this.ownerId, projectId });
      if (!namespace) throw new Error("Project-scoped facts require a Project session.");
      return namespace;
    }
    if (domain === "agent_self") return agentNamespace(this.botId);
    return contentNamespace(this.botId);
  }

  private checkProposal(proposal: unknown, projectId: string | null): string | null {
    if (!isRecord(proposal)) return "Malformed extraction item: expected an object.";
    if (!DOMAINS.includes(proposal.domain as MemoryDomain)) return "Malformed extraction item: unknown domain.";
    if (!TYPES.includes(proposal.type as MemorySemanticType)) return "Malformed extraction item: unknown type.";
    if (!String(proposal.subject ?? "").trim()) return "Malformed extraction item: subject is required.";
    if (!String(proposal.value ?? "").trim()) return "Malformed extraction item: value is required.";
    if (proposal.domain === "project" && !projectId) {
      return "Project-scoped facts require a Project session.";
    }
    return null;
  }

  private emptyResult(
    conversationId: string,
    status: SessionExtractionStatus,
    failureReasons: string[]
  ): SessionExtractionResult {
    return {
      conversationId,
      status,
      messageRevision: "",
      processedThroughId: null,
      savedMemoryIds: [],
      savedDocRefs: [],
      pendingCandidateIds: [],
      failureReasons
    };
  }

  private persist(input: {
    conversationId: string;
    channel: string;
    projectId: string | null;
    ownerExternalUserId: string | null;
    messageRevision: string;
    processedThroughId: string | null;
    processedThroughAt: string | null;
    status: "saved" | "no-useful-information" | "pending-review" | "failed";
    runKey: string;
    savedMemoryIds?: string[];
    savedDocRefs?: ExtractionDocRef[];
    pendingCandidateIds?: string[];
    failureReasons?: string[];
    suppressedCount?: number;
  }): SessionExtractionResult {
    // A retry must never erase previously saved references: union them with
    // this run's, since the gateway's duplicate suppression returns null for
    // already-saved items instead of a second reference.
    const previous = this.store.get(input.conversationId);
    const savedMemoryIds = [...new Set([...(previous?.savedMemoryIds ?? []), ...(input.savedMemoryIds ?? [])])];
    const savedDocRefs = [...(previous?.savedDocRefs ?? []), ...(input.savedDocRefs ?? [])].filter(
      (ref, index, all) => all.findIndex((other) => other.docId === ref.docId) === index
    );
    // Previously pending candidates stay pending only while the gateway still
    // holds them as pending — a review-flow confirmation drops them here
    // instead of blocking archiving forever.
    const livePending = (previous?.pendingCandidateIds ?? []).filter((id) => {
      if (!this.gateway.getCandidate) return true;
      try {
        return this.gateway.getCandidate(id)?.status === "pending";
      } catch {
        return true;
      }
    });
    const pendingCandidateIds = [...new Set([...livePending, ...(input.pendingCandidateIds ?? [])])];
    const receipt = this.store.upsert({
      conversationId: input.conversationId,
      channel: input.channel,
      sessionId: input.conversationId,
      projectId: input.projectId,
      ownerExternalUserId: input.ownerExternalUserId,
      botId: this.botId,
      messageRevision: input.messageRevision,
      processedThroughId: input.processedThroughId,
      processedThroughAt: input.processedThroughAt,
      status: input.status,
      savedMemoryIds,
      savedDocRefs,
      pendingCandidateIds,
      failureReasons: input.failureReasons ?? [],
      suppressedCount: Math.max(previous?.suppressedCount ?? 0, input.suppressedCount ?? 0),
      runKey: input.runKey
    });
    return this.toResult(receipt);
  }

  private toResult(receipt: {
    conversationId: string;
    status: "saved" | "no-useful-information" | "pending-review" | "failed";
    messageRevision: string;
    processedThroughId: string | null;
    savedMemoryIds: string[];
    savedDocRefs: ExtractionDocRef[];
    pendingCandidateIds: string[];
    failureReasons: string[];
  }): SessionExtractionResult {
    return {
      conversationId: receipt.conversationId,
      status: receipt.status,
      messageRevision: receipt.messageRevision,
      processedThroughId: receipt.processedThroughId,
      savedMemoryIds: [...receipt.savedMemoryIds],
      savedDocRefs: receipt.savedDocRefs.map((ref) => ({ ...ref })),
      pendingCandidateIds: [...receipt.pendingCandidateIds],
      failureReasons: [...receipt.failureReasons]
    };
  }
}

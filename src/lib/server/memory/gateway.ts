import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createHash } from "node:crypto";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { builtInMemoryImporters } from "$lib/server/memory/importerRegistry.js";
import type { MemoryImporter } from "$lib/server/memory/importers.js";
import { builtInMemoryBackends, type MemoryBackendDefinition } from "$lib/server/memory/registry.js";
import type {
  MemoryAddInput,
  MemoryBackend,
  MemoryBackendCapabilities,
  MemoryCompactResult,
  MemoryCandidate,
  MemoryCandidateCreateInput,
  MemoryCandidateEdit,
  MemoryCandidateStatus,
  MemoryFlushResult,
  MemoryInjectionItem,
  MemoryPromptSnapshot,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult,
  MemoryUpdateInput
} from "$lib/server/memory/types.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { MemoryCandidateStore, candidateFingerprint } from "$lib/server/memory/candidateStore.js";
import { ownerNamespace } from "$lib/server/memory/namespaces.js";
import { agentNamespace, contentNamespace } from "$lib/server/memory/namespaces.js";
import {
  clearImportedMemorySuppression,
  suppressImportedMemory
} from "$lib/server/memory/importTombstones.js";
import {
  assessMemoryWrite,
  inferMemoryTags,
  normalizeMemoryContent,
  prepareMemoryAddInput,
  selectPromptMemoryRows
} from "$lib/server/memory/classifier.js";
import { appendMemoryGovernanceRejection } from "$lib/server/memory/governanceLog.js";
import type { MemoryTraceFeedbackValue, SqliteMemoryTraceStore } from "$lib/server/memory/traceStore.js";
import { MemoryProfileBuilder, type MemoryProfileResult, type MemoryProfileScope } from "$lib/server/memory/profileBuilder.js";
import { deriveMemoryAccessScope } from "$lib/server/memory/namespaces.js";
import { tokenizeWords } from "#mory";
import { getMemoryProfileSnapshotStore, type MemoryProfileSnapshotStore } from "$lib/server/memory/profileSnapshotStore.js";
import type { MemoryProfileTurnSnapshot } from "$lib/server/memory/types.js";

export class MemoryCandidateValidationError extends Error {
  override readonly name = "MemoryCandidateValidationError";
}

export class MemoryGateway {
  private readonly backends: Record<string, MemoryBackend>;
  private readonly backendDefinitions: MemoryBackendDefinition[];
  private readonly importers: MemoryImporter[];
  private readonly candidates: MemoryCandidateStore;
  private readonly profileSnapshots?: MemoryProfileSnapshotStore;
  private embeddingConfigKey = "";

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    sessions: SessionStore,
    private readonly governanceLogPath?: string,
    options?: {
      candidateStore?: MemoryCandidateStore;
      backends?: Record<string, MemoryBackend>;
      backendDefinitions?: MemoryBackendDefinition[];
      importers?: MemoryImporter[];
      profileSnapshotStore?: MemoryProfileSnapshotStore;
    }
  ) {
    this.backendDefinitions = options?.backendDefinitions ?? builtInMemoryBackends;
    this.backends = options?.backends ?? Object.fromEntries(
      this.backendDefinitions.map((backend) => [backend.key, backend.create(sessions)])
    );
    this.importers = options?.importers ?? builtInMemoryImporters;
    this.candidates = options?.candidateStore ?? new MemoryCandidateStore(storagePaths.moryDbFile);
    this.profileSnapshots = options?.profileSnapshotStore;
  }

  isEnabled(): boolean {
    return this.getSettings().plugins.memory.enabled;
  }

  private getBackend(): MemoryBackend {
    const settings = this.getSettings();
    const key = settings.plugins.memory.backend || "json-file";
    const backend = this.backends[key] ?? this.backends["json-file"];
    this.configureEmbedding(backend, settings);
    return backend;
  }

  private configureEmbedding(backend: MemoryBackend, settings: RuntimeSettings): void {
    if (!backend.configureEmbedder) return;
    const providerId = settings.plugins.memory.embeddingProviderId?.trim();
    const model = settings.plugins.memory.embeddingModel?.trim();
    const provider = settings.customProviders.find((item) => item.id === providerId && item.enabled);
    const apiKeyDigest = provider?.apiKey
      ? createHash("sha256").update(provider.apiKey).digest("hex")
      : "missing";
    const key = provider && model ? `${provider.id}:${provider.baseUrl}:${model}:${apiKeyDigest}` : "disabled";
    if (key === this.embeddingConfigKey) return;
    this.embeddingConfigKey = key;
    if (!provider || !model || !provider.apiKey) {
      backend.configureEmbedder(undefined, undefined);
      return;
    }
    const endpoint = `${provider.baseUrl.replace(/\/+$/, "").replace(/\/(chat\/completions|responses)$/i, "")}/embeddings`;
    backend.configureEmbedder(async (text) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model, input: text })
      });
      if (!response.ok) throw new Error(`Embedding request failed with status ${response.status}.`);
      const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
      const embedding = payload.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) throw new Error("Embedding provider returned no vector.");
      return embedding.map(Number);
    }, `${provider.id}:${model}`);
  }

  getActiveBackendKey(): string {
    const settings = this.getSettings();
    const requested = settings.plugins.memory.backend || "json-file";
    return this.backends[requested] ? requested : "json-file";
  }

  listAvailableBackendKeys(): string[] {
    return this.backendDefinitions.map((backend) => backend.key);
  }

  listImporterKeys(): string[] {
    return this.importers.map((importer) => importer.key);
  }

  capabilities(): MemoryBackendCapabilities | null {
    if (!this.isEnabled()) return null;
    return this.getBackend().capabilities();
  }

  createCandidate(input: MemoryCandidateCreateInput): MemoryCandidate | null {
    if (!this.isEnabled() || this.getActiveBackendKey() !== "mory") return null;
    const validated = this.validateCandidate(input);
    return this.candidates.create({ ...validated, fingerprint: input.fingerprint || candidateFingerprint(validated) });
  }

  async maybeAutoConfirmCandidate(id: string): Promise<MemoryCandidate | null> {
    const policy = this.getSettings().plugins.memory.autoConfirm;
    if (!policy?.enabled) return this.candidates.get(id);
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.status !== "pending") return candidate;
    const sensitivePreference = /(?:health|medical|disease|medication|location|address|identity|religion|politic|sexual|lifestyle|健康|疾病|药物|住址|位置|身份|宗教|政治|性取向|生活方式)/i
      .test(`${candidate.subject} ${candidate.value}`);
    const allowedType = candidate.type === "user_preference" && candidate.domain === "owner" && !sensitivePreference
      || (policy.allowProjectTasks && candidate.type === "task" && candidate.domain === "project");
    const sessions = new Set(candidate.sources.map((source) => source.sessionId));
    if (!allowedType
      || (candidate.occurrenceCount ?? 1) < policy.occurrenceThreshold
      || candidate.confidence < policy.confidenceThreshold
      || sessions.size < 2
      || (candidate.evidenceDates?.length ?? 0) < 2
      || (candidate.possibleRelations?.length ?? 0) > 0) return candidate;
    return this.confirmCandidate(id, { reason: `${candidate.reason}; audit:auto-confirm` });
  }

  async revokeAutoConfirmedCandidate(id: string): Promise<{ revoked: boolean; predecessorRestored: boolean; needsReview: boolean }> {
    const candidate = this.candidates.get(id);
    if (!candidate?.confirmedMemoryId || !candidate.reason.includes("audit:auto-confirm")) {
      return { revoked: false, predecessorRestored: false, needsReview: false };
    }
    const namespaceParts = candidate.namespace.split(":");
    const governanceScope = {
      channel: candidate.sources[0]?.channel ?? "web",
      externalUserId: candidate.sources[0]?.sessionId ?? "memory-governance",
      botId: this.botIdFromNamespace(candidate.namespace),
      ownerId: candidate.domain === "owner" ? namespaceParts.slice(1).join(":") : undefined,
      projectId: candidate.domain === "project" ? namespaceParts.slice(2).join(":") : undefined
    };
    const memory = await this.getForGovernance(governanceScope, candidate.confirmedMemoryId);
    if (!memory || memory.state === "archived") return { revoked: false, predecessorRestored: false, needsReview: false };
    const records = await this.listForMaintenance(governanceScope);
    const versions = await this.versions(governanceScope, memory.id);
    const laterSuccessors = records.filter((record) => record.supersedes === memory.id && record.state !== "archived");
    await this.delete(governanceScope, memory.id);
    const predecessorId = memory.supersedes ?? candidate.supersedesMemoryId;
    if (!predecessorId) return { revoked: true, predecessorRestored: false, needsReview: false };
    const predecessor = versions.find((record) => record.id === predecessorId);
    const otherActiveSuccessors = records.filter((record) =>
      record.supersedes === predecessorId && record.id !== memory.id && record.state !== "archived"
    );
    if (!predecessor || laterSuccessors.length > 0 || otherActiveSuccessors.length > 0) {
      return { revoked: true, predecessorRestored: false, needsReview: true };
    }
    const restored = await this.getBackend().restoreArchived?.(governanceScope, predecessor.id);
    if (!restored) return { revoked: true, predecessorRestored: false, needsReview: true };
    return { revoked: true, predecessorRestored: true, needsReview: false };
  }

  listCandidates(status?: MemoryCandidateStatus, limit?: number): MemoryCandidate[] {
    if (!this.isEnabled()) return [];
    return this.candidates.list(status, limit);
  }

  async confirmCandidate(id: string, edit?: MemoryCandidateEdit): Promise<MemoryCandidate | null> {
    if (!this.isEnabled() || this.getActiveBackendKey() !== "mory") return null;
    const reserved = this.candidates.reserveConfirmation(id);
    if (!reserved) return this.candidates.get(id);
    try {
      if (reserved.skillDraftSuggestion) throw new Error("Skill suggestions must be confirmed through the draft review flow.");
      const definedEdit = edit
        ? Object.fromEntries(Object.entries(edit).filter(([, value]) => typeof value !== "undefined")) as MemoryCandidateEdit
        : undefined;
      if (definedEdit?.namespace && definedEdit.namespace !== reserved.namespace) {
        throw new Error("Candidate namespace identity cannot be changed during confirmation.");
      }
      if (definedEdit?.domain && definedEdit.domain !== reserved.domain) {
        throw new Error("Candidate domain identity cannot be changed during confirmation.");
      }
      const merged = this.validateCandidate({ ...reserved, ...definedEdit, fingerprint: reserved.fingerprint });
      if (this.candidates.isSuppressed(merged)) throw new Error("Candidate content is suppressed.");
      const memory = await this.getBackend().add({
        channel: merged.sources[0]?.channel ?? "web",
        externalUserId: merged.sources[0]?.sessionId ?? "memory-candidate",
        botId: this.botIdFromNamespace(merged.namespace),
        projectId: merged.domain === "project" ? this.projectIdFromNamespace(merged.namespace) : undefined
      }, {
        content: merged.value,
        namespace: merged.namespace,
        domain: merged.domain,
        type: merged.type,
        subject: merged.subject,
        confidence: merged.confidence,
        reason: merged.reason,
        sources: merged.sources,
        layer: merged.layer,
        expiresAt: merged.expiresAt,
        pinned: merged.pinned
      });
      return this.candidates.completeConfirmation(id, merged, memory.id, Boolean(definedEdit && Object.keys(definedEdit).length > 0));
    } catch (cause) {
      this.candidates.releaseConfirmation(id);
      throw cause;
    }
  }

  prepareSkillDraftSuggestions(isSuccessfulExecution: (sourceEntryId: string) => boolean): MemoryCandidate[] {
    const prepared: MemoryCandidate[] = [];
    for (const candidate of this.candidates.list("pending", 1_000)) {
      if (candidate.type !== "skill" || candidate.skillDraftSuggestion || (candidate.occurrenceCount ?? 1) < 3) continue;
      const successful = candidate.sources.filter((source) => isSuccessfulExecution(source.conversationMessageId));
      if (new Set(successful.map((source) => `${source.sessionId}:${source.conversationMessageId}`)).size < 2) continue;
      const updated = this.candidates.setSkillDraftSuggestion(candidate.id, {
        description: candidate.value,
        inputs: ["The user-provided inputs referenced by the successful source runs."],
        outputs: ["A verified result matching the successful source runs."],
        boundaries: [
          "Create a reviewable draft only; never execute or publish it automatically.",
          "Do not copy secrets, absolute attachment paths, system prompts, or tool-result payloads."
        ],
        successfulExecutionCount: successful.length
      });
      if (updated) prepared.push(updated);
    }
    return prepared;
  }

  async confirmSkillDraftSuggestion(
    id: string,
    createDraft: (candidate: MemoryCandidate) => Promise<string> | string
  ): Promise<MemoryCandidate | null> {
    if (!this.isEnabled() || this.getActiveBackendKey() !== "mory") return null;
    const reserved = this.candidates.reserveConfirmation(id);
    if (!reserved) return this.candidates.get(id);
    try {
      if (reserved.type !== "skill" || !reserved.skillDraftSuggestion) throw new Error("Candidate is not a verified Skill draft suggestion.");
      const reference = await createDraft(reserved);
      if (!String(reference).trim()) throw new Error("Skill draft writer returned no review reference.");
      return this.candidates.completeConfirmation(id, reserved, `draft:${reference}`, false);
    } catch (cause) {
      this.candidates.releaseConfirmation(id);
      throw cause;
    }
  }

  ignoreCandidate(id: string): MemoryCandidate | null {
    if (!this.isEnabled()) return null;
    return this.candidates.ignore(id);
  }

  private validateCandidate(input: MemoryCandidateCreateInput): MemoryCandidateCreateInput {
    const value = normalizeMemoryContent(input.value);
    if (!value) throw new MemoryCandidateValidationError("Candidate value is required.");
    if (!input.namespace || !input.domain || !input.type || !String(input.subject ?? "").trim()) {
      throw new MemoryCandidateValidationError("Candidate namespace, domain, type, and subject are required.");
    }
    const expectedPrefix = input.domain === "owner" ? "owner:"
      : input.domain === "project" ? "project:"
        : input.domain === "agent_self" ? "agent:"
          : "content:";
    if (!input.namespace.startsWith(expectedPrefix)) {
      throw new MemoryCandidateValidationError(`Candidate namespace does not match domain '${input.domain}'.`);
    }
    if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.some((source) =>
      !source.channel || !source.sessionId || !source.conversationMessageId
    )) throw new MemoryCandidateValidationError("Candidate sources require channel, sessionId, and conversationMessageId.");
    const assessed = assessMemoryWrite({
      content: value,
      type: input.type,
      subject: input.subject,
      domain: input.domain,
      namespace: input.namespace,
      confidence: input.confidence,
      reason: input.reason,
      sources: input.sources,
      layer: input.layer,
      expiresAt: input.expiresAt,
      pinned: input.pinned
    });
    if (!assessed.allowed) throw new MemoryCandidateValidationError(assessed.reason || "Candidate rejected by memory governance.");
    const subject = String(input.subject).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[_ .-]+|[_ .-]+$/g, "");
    if (!subject) throw new MemoryCandidateValidationError("Candidate subject is invalid.");
    return {
      ...input,
      value,
      subject,
      path: `mory://${input.type}/${subject}`,
      confidence: Math.max(0, Math.min(1, Number(input.confidence))),
      reason: String(input.reason ?? "").trim() || "reflection",
      sources: input.sources.map((source) => ({ ...source })),
      layer: input.layer === "daily" ? "daily" : "long_term"
    };
  }

  private botIdFromNamespace(namespace: string): string | undefined {
    const parts = namespace.split(":");
    return parts[0] === "chat" || parts[0] === "agent" || parts[0] === "content" ? decodeURIComponent(parts[1] ?? "") : undefined;
  }

  private projectIdFromNamespace(namespace: string): string | undefined {
    const parts = namespace.split(":");
    return parts[0] === "project" ? decodeURIComponent(parts[2] ?? "") : undefined;
  }

  async add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    const assessed = assessMemoryWrite(input);
    if (!assessed.allowed || !assessed.prepared) {
      if (this.governanceLogPath) {
        appendMemoryGovernanceRejection({
          filePath: this.governanceLogPath,
          scope,
          action: "add",
          input,
          reason: assessed.reason || "Memory write rejected."
        });
      }
      throw new Error(assessed.reason || "Memory write rejected.");
    }
    const prepared = assessed.prepared;
    clearImportedMemorySuppression(scope, prepared.layer ?? "long_term", prepared.content);
    return this.getBackend().add(scope, prepared);
  }

  async search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return (await this.getBackend().search(scope, input))
      .map((record) => this.withGovernanceState(record))
      .filter((record) => !record.privacySuppressed);
  }

  async getForGovernance(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    const record = await this.getBackend().get(scope, id);
    return record ? this.withGovernanceState(record) : null;
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return (await this.getBackend().searchAll(input)).map((record) => this.withGovernanceState(record));
  }

  async searchContent(botId: string, input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    const backend = this.getBackend();
    const namespace = contentNamespace(botId);
    if (backend.searchNamespaces) {
      return backend.searchNamespaces([namespace], { channel: "web", externalUserId: "content", botId }, input);
    }
    return (await backend.searchAll({ ...input, limit: Math.max(input.limit ?? 20, 200) }))
      .filter((record) => record.namespace === namespace)
      .slice(0, input.limit ?? 20);
  }

  async addContentMemory(botId: string, input: Omit<MemoryAddInput, "namespace" | "domain">): Promise<MemoryRecord | null> {
    return this.add({ channel: "web", externalUserId: "content", botId }, {
      ...input,
      namespace: contentNamespace(botId),
      domain: "content",
      expiresAt: undefined
    });
  }

  async setAgentSelfMemory(botId: string, input: Omit<MemoryAddInput, "namespace" | "domain">): Promise<MemoryRecord | null> {
    return this.add({ channel: "web", externalUserId: "agent-self", botId }, {
      ...input,
      namespace: agentNamespace(botId),
      domain: "agent_self"
    });
  }

  async delete(scope: MemoryScope, id: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const existing = await this.getBackend().get(scope, id);
    const deleted = await this.getBackend().delete(scope, id);
    if (deleted && existing) {
      suppressImportedMemory(scope, existing.layer, existing.content);
    }
    return deleted;
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    const existing = await this.getBackend().get(scope, id);
    const nextInput: MemoryUpdateInput = { ...input };
    if (existing && typeof input.content === "string") {
      const assessed = assessMemoryWrite({
        content: input.content,
        tags: Array.isArray(input.tags) ? input.tags : existing.tags,
        layer: existing.layer,
        expiresAt: typeof input.expiresAt === "string" ? input.expiresAt : existing.expiresAt
      });
      if (!assessed.allowed || !assessed.prepared) {
        if (this.governanceLogPath) {
          appendMemoryGovernanceRejection({
            filePath: this.governanceLogPath,
            scope,
            action: "update",
            input: {
              content: String(input.content ?? existing.content),
              tags: Array.isArray(input.tags) ? input.tags : existing.tags,
              layer: existing.layer,
              expiresAt: typeof input.expiresAt === "string" ? input.expiresAt : existing.expiresAt
            },
            reason: assessed.reason || "Memory update rejected."
          });
        }
        throw new Error(assessed.reason || "Memory update rejected.");
      }
      nextInput.content = assessed.prepared.content;
      nextInput.tags = assessed.prepared.tags ?? inferMemoryTags(
        nextInput.content,
        Array.isArray(input.tags) ? input.tags : existing.tags
      );
    }
    const updated = await this.getBackend().update(scope, id, nextInput);
    if (existing && typeof input.content === "string") {
      const nextContent = normalizeMemoryContent(input.content);
      if (nextContent && normalizeMemoryContent(existing.content).toLowerCase() !== nextContent.toLowerCase()) {
        suppressImportedMemory(scope, existing.layer, existing.content);
        clearImportedMemorySuppression(scope, existing.layer, input.content);
      }
    }
    return updated;
  }

  async suppressPrivacy(scope: MemoryScope, id: string, options: { idempotencyKey: string; reason: string }): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    const existing = await this.getBackend().get(scope, id);
    if (!existing) return null;
    const shape = this.governanceShape(existing);
    if (!shape) throw new Error("Memory lacks canonical identity required for privacy suppression.");
    const suppression = this.candidates.suppressForPrivacy(shape, { ...options, memoryId: id });
    const updated = await this.getBackend().update(scope, id, {
      allowInjection: false,
      privacySuppressed: true,
      suppressionKey: suppression.suppressionKey
    });
    return updated ? this.withGovernanceState(updated) : this.withGovernanceState(existing);
  }

  async restorePrivacy(scope: MemoryScope, id: string, options: { idempotencyKey: string; reason: string }): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    const existing = await this.getBackend().get(scope, id);
    if (!existing) return null;
    const shape = this.governanceShape(existing);
    if (!shape) throw new Error("Memory lacks canonical identity required for privacy restoration.");
    this.candidates.restorePrivacySuppression(shape, { ...options, memoryId: id });
    const updated = await this.getBackend().update(scope, id, {
      allowInjection: true,
      privacySuppressed: false,
      suppressionKey: null
    });
    return updated ? this.withGovernanceState(updated) : this.withGovernanceState(existing);
  }

  async applyTraceFeedback(
    traceStore: SqliteMemoryTraceStore,
    input: {
      traceId: string;
      memoryId: string;
      value: MemoryTraceFeedbackValue;
      comment?: string;
      idempotencyKey: string;
    }
  ): Promise<{ duplicate: boolean; memory: MemoryRecord }> {
    const trace = traceStore.getById(input.traceId);
    if (!trace) throw new Error("Memory trace not found.");
    const existing = await this.getBackend().get(trace.scope, input.memoryId);
    if (!existing) throw new Error("Memory is not authorized in the trace scope.");
    const recorded = traceStore.recordFeedback(input);
    const previousEffect = traceStore.getFeedbackEffect(input.traceId, input.memoryId);
    const contributionFor = (value: MemoryTraceFeedbackValue): number => value === "helpful" ? 0.08 : value === "irrelevant" ? -0.08 : 0;
    const currentValues = traceStore.listCurrentFeedbackValues(input.memoryId);
    const baseUtility = traceStore.getOrCreateBaseUtility(input.memoryId, existing.utility ?? 0.5);
    const utility = Math.max(0, Math.min(1, baseUtility + currentValues.reduce((sum, item) => sum + contributionFor(item.value), 0)));
    const patch: MemoryUpdateInput = { utility };
    let ownsDispute = previousEffect?.ownsDispute ?? false;
    let previousConfidence = previousEffect?.previousConfidence;
    let ownsExpiry = previousEffect?.ownsExpiry ?? false;
    let previousExpiresAt = previousEffect?.previousExpiresAt;

    if (input.value === "incorrect" && previousEffect?.value !== "incorrect") {
      if (existing.state !== "disputed") {
        ownsDispute = true;
        previousConfidence = existing.confidence;
        patch.state = "disputed";
        patch.confidence = Math.max(0, (existing.confidence ?? 0.7) - 0.15);
      }
    } else if (input.value !== "incorrect" && ownsDispute && !currentValues.some((item) => item.value === "incorrect")) {
      patch.state = "active";
      if (typeof previousConfidence === "number") patch.confidence = previousConfidence;
      ownsDispute = false;
    }

    if (input.value === "expired" && previousEffect?.value !== "expired") {
      ownsExpiry = true;
      previousExpiresAt = existing.expiresAt;
      patch.expiresAt = new Date().toISOString();
    } else if (input.value !== "expired" && ownsExpiry && !currentValues.some((item) => item.value === "expired")) {
      patch.expiresAt = previousExpiresAt ?? null;
      ownsExpiry = false;
    }

    if (input.value === "too_private") {
      await this.suppressPrivacy(trace.scope, input.memoryId, {
        idempotencyKey: `feedback-privacy:${recorded.event.id}`,
        reason: "too_private"
      });
    }
    const updated = await this.getBackend().update(trace.scope, input.memoryId, patch);
    if (!updated) throw new Error("Memory feedback effect could not be applied.");
    traceStore.saveFeedbackEffect({
      traceId: input.traceId,
      memoryId: input.memoryId,
      value: input.value,
      utilityContribution: contributionFor(input.value),
      ownsDispute,
      previousConfidence,
      ownsExpiry,
      previousExpiresAt,
      updatedAt: new Date().toISOString()
    });
    traceStore.markFeedbackEffectApplied(recorded.event.id);
    return { duplicate: recorded.duplicate, memory: this.withGovernanceState(updated) };
  }

  async replayPendingTraceFeedback(traceStore: SqliteMemoryTraceStore, options: { dryRun?: boolean; limit?: number } = {}): Promise<{ pendingCount: number; appliedCount: number; failedCount: number }> {
    traceStore.enqueueHistoricalFeedbackEffects();
    const events = traceStore.listPendingFeedbackEffects(options.limit ?? 100);
    if (options.dryRun) return { pendingCount: events.length, appliedCount: 0, failedCount: 0 };
    let appliedCount = 0;
    let failedCount = 0;
    for (const event of events) {
      try {
        await this.applyTraceFeedback(traceStore, {
          traceId: event.traceId,
          memoryId: event.memoryId,
          value: event.value,
          comment: event.comment,
          idempotencyKey: event.idempotencyKey
        });
        appliedCount += 1;
      } catch (cause) {
        failedCount += 1;
        traceStore.markFeedbackEffectFailed(event.id, cause instanceof Error ? cause.message : String(cause));
      }
    }
    return { pendingCount: events.length, appliedCount, failedCount };
  }

  async recordSuccessfulInjectionUsage(scope: MemoryScope, traceId: string, memoryIds: string[], injectedAt = new Date().toISOString()): Promise<number> {
    const backend = this.getBackend();
    if (!backend.recordInjectionUsage) return 0;
    let recorded = 0;
    for (const memoryId of [...new Set(memoryIds.filter(Boolean))]) {
      if (await backend.recordInjectionUsage(scope, memoryId, `${traceId}:${memoryId}`, injectedAt)) recorded += 1;
    }
    return recorded;
  }

  async disputeFromImmediateCorrection(scope: MemoryScope, memoryIds: string[]): Promise<string[]> {
    const disputed: string[] = [];
    for (const memoryId of [...new Set(memoryIds)]) {
      const existing = await this.getForGovernance(scope, memoryId);
      if (!existing || existing.state !== "active") continue;
      const updated = await this.getBackend().update(scope, memoryId, { state: "disputed" });
      if (updated?.state === "disputed") disputed.push(memoryId);
    }
    return disputed;
  }

  async buildProfile(input: Omit<MemoryProfileScope, "authorizedNamespaces">): Promise<MemoryProfileResult> {
    const derived = deriveMemoryAccessScope({
      ...input,
      shareOwner: input.includeOwner
    });
    const authorizedNamespaces = derived.authorizedNamespaces.filter((namespace) =>
      (input.includeAgentSelf || !namespace.startsWith("agent:"))
      && (input.includeOwner || !namespace.startsWith("owner:"))
    );
    const scope: MemoryProfileScope = { ...input, authorizedNamespaces };
    const backend = this.getBackend();
    const builder = new MemoryProfileBuilder(async (profileScope, limit) => {
      const items = backend.listProfileRecords
        ? await backend.listProfileRecords(profileScope.authorizedNamespaces, profileScope, limit)
        : await backend.searchNamespaces?.(profileScope.authorizedNamespaces, profileScope, { query: "", mode: "recent", limit }) ?? [];
      const governed = items.map((record) => this.withGovernanceState(record));
      return { items: governed, scannedCount: governed.length, truncated: governed.length >= limit };
    });
    return builder.build(scope);
  }

  async listForMaintenance(scope: MemoryScope, limit = 10_000): Promise<MemoryRecord[]> {
    const backend = this.getBackend();
    const rows = backend.listMaintenanceRecords
      ? await backend.listMaintenanceRecords(scope, limit)
      : await backend.search(scope, { query: "", mode: "recent", limit: Math.min(limit, 500) });
    return rows.map((record) => this.withGovernanceState(record));
  }

  async createProfileTurnSnapshot(sessionId: string, input: Omit<MemoryProfileScope, "authorizedNamespaces">, tokenBudget = 500): Promise<MemoryProfileTurnSnapshot> {
    const profile = await this.buildProfile(input);
    const candidates = [...profile.stablePreferences, ...profile.profileFacts];
    const items: MemoryInjectionItem[] = [];
    let usedTokens = 0;
    for (const record of candidates) {
      const promptText = `- ${record.content.replace(/\s+/g, " ").trim()}`;
      const tokens = tokenizeWords(promptText).length;
      if (tokens === 0 || usedTokens + tokens > tokenBudget) continue;
      usedTokens += tokens;
      items.push({
        memoryId: record.id,
        order: items.length,
        promptText,
        source: "profile" as const,
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
      });
    }
    const scopeKey = createHash("sha256").update(JSON.stringify(profile.meta.scope)).digest("hex");
    const base = (this.profileSnapshots ?? getMemoryProfileSnapshotStore()).getOrCreate(sessionId, scopeKey, items);
    const revokedMemoryIds: string[] = [];
    const effectiveItems: MemoryInjectionItem[] = [];
    for (const item of base.baseItems) {
      const current = await this.getForGovernance(input, item.memoryId);
      const revoked = !current
        || current.state !== "active"
        || current.hasConflict
        || current.allowInjection === false
        || current.privacySuppressed
        || Boolean(current.expiresAt && !current.pinned && Date.parse(current.expiresAt) <= Date.now());
      if (revoked) revokedMemoryIds.push(item.memoryId);
      else effectiveItems.push(item);
    }
    return { ...base, revokedMemoryIds, effectiveItems };
  }

  async versions(scope: MemoryScope, id: string): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return this.getBackend().versions?.(scope, id) ?? [];
  }

  async flush(scope: MemoryScope): Promise<MemoryFlushResult> {
    if (!this.isEnabled()) {
      return {
        scannedMessages: 0,
        addedCount: 0,
        memories: [],
        updatedCursorConversations: 0
      };
    }
    return this.getBackend().flush(scope);
  }

  async compact(scope?: MemoryScope): Promise<MemoryCompactResult> {
    if (!this.isEnabled()) {
      return { scannedCount: 0, removedCount: 0, scopesAffected: 0 };
    }
    return this.getBackend().compact(scope);
  }

  async buildPromptContext(scope: MemoryScope, query: string, limit = 5): Promise<string> {
    const snapshot = await this.createPromptSnapshot(scope, query, limit);
    return snapshot.promptText;
  }

  async createPromptSnapshot(scope: MemoryScope, query: string, limit = 5): Promise<MemoryPromptSnapshot> {
    if (!this.isEnabled()) {
      return {
        createdAt: new Date().toISOString(),
        scope,
        query,
        fingerprint: "disabled",
        promptText: "",
        longTerm: [],
        daily: [],
        selected: []
      };
    }
    const rows = dedupeMemoryRows(await this.search(scope, { query, limit: Math.max(limit * 4, 20), mode: "hybrid" }))
      .filter((row) => row.state === "active" && !row.hasConflict && row.allowInjection !== false && !row.privacySuppressed);
    if (rows.length === 0) {
      return {
        createdAt: new Date().toISOString(),
        scope,
        query,
        fingerprint: "empty",
        promptText: "",
        longTerm: [],
        daily: [],
        selected: []
      };
    }
    const { longTerm, daily } = selectPromptMemoryRows(rows, query, limit);
    const sections: string[] = [];
    if (longTerm.length > 0) {
      sections.push(
        "Long-term memory:\n" +
          longTerm.map((row, idx) => `${idx + 1}. ${row.content}`).join("\n")
      );
    }
    if (daily.length > 0) {
      sections.push(
        "Recent daily memory:\n" +
          daily.map((row, idx) => `${idx + 1}. ${row.content}`).join("\n")
      );
    }
    const selected = [...longTerm, ...daily];
    const promptText = sections.join("\n\n");
    const fingerprint = selected
      .map((row) => `${row.id}:${row.updatedAt}`)
      .join("|") || "empty";
    return {
      createdAt: new Date().toISOString(),
      scope,
      query,
      fingerprint,
      promptText,
      longTerm,
      daily,
      selected
    };
  }

  async syncExternalMemories(): Promise<MemorySyncResult> {
    if (!this.isEnabled()) return { scannedFiles: 0, importedCount: 0 };
    const backend = this.getBackend();
    let scannedFiles = 0;
    let importedCount = 0;

    for (const importer of this.importers) {
      const result = await importer.sync({
        add: async (scope, input) => {
          const content = normalizeMemoryContent(input.content);
          const digest = createHash("sha256").update(`${importer.key}:${scope.channel}:${scope.externalUserId}:${content}`).digest("hex");
          this.createCandidate({
            namespace: ownerNamespace(scope.ownerId),
            domain: "owner",
            type: "user_fact",
            subject: `imported_${digest.slice(0, 16)}`,
            path: `mory://user_fact/imported_${digest.slice(0, 16)}`,
            value: content,
            confidence: 0.7,
            reason: `importer:${importer.key}`,
            sources: [{
              channel: scope.channel,
              sessionId: `import:${importer.key}`,
              conversationMessageId: `import:${digest}`
            }],
            layer: input.layer ?? "long_term"
          });
        },
        search: (scope, input) => backend.search(scope, input)
      });
      scannedFiles += result.scannedFiles;
      importedCount += result.importedCount;
    }

    return { scannedFiles, importedCount };
  }

  async migrateJsonFileToMory(): Promise<{ scannedCount: number; candidateCount: number; rejectedCount: number }> {
    if (!this.isEnabled() || this.getActiveBackendKey() !== "mory") {
      return { scannedCount: 0, candidateCount: 0, rejectedCount: 0 };
    }
    const legacy = this.backends["json-file"];
    if (!legacy) return { scannedCount: 0, candidateCount: 0, rejectedCount: 0 };
    const rows = await legacy.searchAll({ query: "", limit: 10_000, mode: "recent" });
    let candidateCount = 0;
    let rejectedCount = 0;
    for (const row of rows) {
      const digest = createHash("sha256").update(`${row.channel}:${row.externalUserId}:${normalizeMemoryContent(row.content)}`).digest("hex");
      try {
        const created = this.createCandidate({
          namespace: ownerNamespace(),
          domain: "owner",
          type: "user_fact",
          subject: `migrated_${digest.slice(0, 16)}`,
          path: `mory://user_fact/migrated_${digest.slice(0, 16)}`,
          value: row.content,
          confidence: row.confidence ?? 0.7,
          reason: "json-file-migration",
          sources: [{ channel: row.channel, sessionId: row.sourceSessionId ?? "json-file-migration", conversationMessageId: `migration:${row.id}` }],
          layer: row.layer,
          expiresAt: row.expiresAt,
          pinned: row.pinned
        });
        if (created) candidateCount += 1;
      } catch (cause) {
        rejectedCount += 1;
        if (this.governanceLogPath) appendMemoryGovernanceRejection({
          filePath: this.governanceLogPath,
          scope: { channel: row.channel, externalUserId: row.externalUserId },
          action: "add",
          input: { content: row.content, layer: row.layer },
          reason: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
    return { scannedCount: rows.length, candidateCount, rejectedCount };
  }

  async backfillEmbeddings(limit?: number): Promise<{ scannedCount: number; updatedCount: number; remainingCount: number }> {
    if (!this.isEnabled()) return { scannedCount: 0, updatedCount: 0, remainingCount: 0 };
    return this.getBackend().backfillEmbeddings?.(limit) ?? { scannedCount: 0, updatedCount: 0, remainingCount: 0 };
  }

  private governanceShape(record: MemoryRecord): Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value"> | null {
    if (!record.namespace || !record.domain || !record.type || !record.subject) return null;
    return { namespace: record.namespace, domain: record.domain, type: record.type, subject: record.subject, value: record.content };
  }

  private withGovernanceState(record: MemoryRecord): MemoryRecord {
    const shape = this.governanceShape(record);
    const privacySuppressed = record.privacySuppressed === true
      || this.candidates.isMemoryPrivacySuppressed(record.id)
      || Boolean(shape && this.candidates.isPrivacySuppressed(shape));
    return privacySuppressed
      ? { ...record, privacySuppressed: true, allowInjection: false }
      : record;
  }
}

function dedupeMemoryRows(rows: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  const deduped: MemoryRecord[] = [];
  for (const row of rows) {
    const key = `${row.layer}:${normalizeMemoryContent(row.content).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

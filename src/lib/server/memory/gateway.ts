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

export class MemoryCandidateValidationError extends Error {
  override readonly name = "MemoryCandidateValidationError";
}

export class MemoryGateway {
  private readonly backends: Record<string, MemoryBackend>;
  private readonly backendDefinitions: MemoryBackendDefinition[];
  private readonly importers: MemoryImporter[];
  private readonly candidates: MemoryCandidateStore;
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
    }
  ) {
    this.backendDefinitions = options?.backendDefinitions ?? builtInMemoryBackends;
    this.backends = options?.backends ?? Object.fromEntries(
      this.backendDefinitions.map((backend) => [backend.key, backend.create(sessions)])
    );
    this.importers = options?.importers ?? builtInMemoryImporters;
    this.candidates = options?.candidateStore ?? new MemoryCandidateStore(storagePaths.moryDbFile);
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

  listCandidates(status?: MemoryCandidateStatus, limit?: number): MemoryCandidate[] {
    if (!this.isEnabled()) return [];
    return this.candidates.list(status, limit);
  }

  async confirmCandidate(id: string, edit?: MemoryCandidateEdit): Promise<MemoryCandidate | null> {
    if (!this.isEnabled() || this.getActiveBackendKey() !== "mory") return null;
    const reserved = this.candidates.reserveConfirmation(id);
    if (!reserved) return this.candidates.get(id);
    try {
      const definedEdit = edit
        ? Object.fromEntries(Object.entries(edit).filter(([, value]) => typeof value !== "undefined")) as MemoryCandidateEdit
        : undefined;
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
    return this.getBackend().search(scope, input);
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return this.getBackend().searchAll(input);
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
      .filter((row) => row.allowInjection !== false);
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

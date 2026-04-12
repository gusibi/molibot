import type { RuntimeSettings } from "../settings/index.js";
import type { SessionStore } from "../sessions/store.js";
import { builtInMemoryImporters } from "./importerRegistry.js";
import type { MemoryImporter } from "./importers.js";
import { builtInMemoryBackends, type MemoryBackendDefinition } from "./registry.js";
import type {
  MemoryAddInput,
  MemoryBackend,
  MemoryBackendCapabilities,
  MemoryCompactResult,
  MemoryFlushResult,
  MemoryPromptSnapshot,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult,
  MemoryUpdateInput
} from "./types.js";
import {
  clearImportedMemorySuppression,
  suppressImportedMemory
} from "./importTombstones.js";
import {
  assessMemoryWrite,
  inferMemoryTags,
  normalizeMemoryContent,
  prepareMemoryAddInput,
  selectPromptMemoryRows
} from "./classifier.js";
import { appendMemoryGovernanceRejection } from "./governanceLog.js";

export class MemoryGateway {
  private readonly backends: Record<string, MemoryBackend>;
  private readonly backendDefinitions: MemoryBackendDefinition[];
  private readonly importers: MemoryImporter[];

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    sessions: SessionStore,
    private readonly governanceLogPath?: string
  ) {
    this.backendDefinitions = builtInMemoryBackends;
    this.backends = Object.fromEntries(
      this.backendDefinitions.map((backend) => [backend.key, backend.create(sessions)])
    );
    this.importers = builtInMemoryImporters;
  }

  isEnabled(): boolean {
    return this.getSettings().plugins.memory.enabled;
  }

  private getBackend(): MemoryBackend {
    const settings = this.getSettings();
    const key = settings.plugins.memory.backend || "json-file";
    return this.backends[key] ?? this.backends["json-file"];
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
    const rows = dedupeMemoryRows(await this.search(scope, { query, limit: Math.max(limit * 4, 20), mode: "hybrid" }));
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
        add: (scope, input) => backend.add(scope, input),
        search: (scope, input) => backend.search(scope, input)
      });
      scannedFiles += result.scannedFiles;
      importedCount += result.importedCount;
    }

    return { scannedFiles, importedCount };
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

import type { RuntimeSettings } from "../config.js";
import type { SessionStore } from "../services/sessionStore.js";
import { builtInMemoryImporters } from "./importerRegistry.js";
import type { MemoryImporter } from "./importers.js";
import { builtInMemoryBackends, type MemoryBackendDefinition } from "./registry.js";
import type {
  MemoryAddInput,
  MemoryBackend,
  MemoryBackendCapabilities,
  MemoryFlushResult,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult,
  MemoryUpdateInput
} from "./types.js";

export class MemoryGateway {
  private readonly backends: Record<string, MemoryBackend>;
  private readonly backendDefinitions: MemoryBackendDefinition[];
  private readonly importers: MemoryImporter[];

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    sessions: SessionStore
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
    return this.getBackend().add(scope, input);
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
    return this.getBackend().delete(scope, id);
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    return this.getBackend().update(scope, id, input);
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

  async buildPromptContext(scope: MemoryScope, query: string, limit = 5): Promise<string> {
    if (!this.isEnabled()) return "";
    const rows = await this.search(scope, { query, limit, mode: "hybrid" });
    if (rows.length === 0) return "";
    const longTerm = rows.filter((row) => row.layer === "long_term");
    const daily = rows.filter((row) => row.layer === "daily");
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
    return sections.join("\n\n");
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

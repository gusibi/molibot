import type { RuntimeSettings } from "../config.js";
import type { SessionStore } from "../services/sessionStore.js";
import { JsonFileMemoryCore } from "./jsonFileCore.js";
import { MoryMemoryCore } from "./moryCore.js";
import type {
  MemoryAddInput,
  MemoryCore,
  MemoryCoreCapabilities,
  MemoryFlushResult,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult,
  MemoryUpdateInput
} from "./types.js";

export class MemoryGateway {
  private readonly cores: Record<string, MemoryCore>;

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    sessions: SessionStore
  ) {
    this.cores = {
      "json-file": new JsonFileMemoryCore(sessions),
      mory: new MoryMemoryCore(sessions)
    };
  }

  isEnabled(): boolean {
    return this.getSettings().plugins.memory.enabled;
  }

  private getCore(): MemoryCore {
    const settings = this.getSettings();
    const key = settings.plugins.memory.core || "json-file";
    return this.cores[key] ?? this.cores["json-file"];
  }

  capabilities(): MemoryCoreCapabilities | null {
    if (!this.isEnabled()) return null;
    return this.getCore().capabilities();
  }

  async add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    return this.getCore().add(scope, input);
  }

  async search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return this.getCore().search(scope, input);
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    if (!this.isEnabled()) return [];
    return this.getCore().searchAll(input);
  }

  async delete(scope: MemoryScope, id: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    return this.getCore().delete(scope, id);
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    if (!this.isEnabled()) return null;
    return this.getCore().update(scope, id, input);
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
    return this.getCore().flush(scope);
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
    return this.getCore().syncExternalMemories();
  }
}

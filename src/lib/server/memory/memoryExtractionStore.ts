import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface MemoryExtractionState {
  processedThroughId: string;
  revision: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
  retryAfter?: string;
}

export interface MemoryExtractionStatePort {
  get(conversationId: string): MemoryExtractionState | null;
  set(conversationId: string, state: MemoryExtractionState): void;
  delete(conversationId: string): void;
}

interface MemoryExtractionStateFile {
  version: 1;
  sessions: Record<string, MemoryExtractionState>;
}

const EMPTY: MemoryExtractionStateFile = { version: 1, sessions: {} };

/**
 * Per-conversation extraction watermark. Kept separate from the Session
 * extraction receipt: the automatic memory pipeline must not mark a Session
 * as "extracted and archived", and a manual extraction must not make the
 * automatic pipeline skip facts it never saw.
 */
export class MemoryExtractionStateStore implements MemoryExtractionStatePort {
  constructor(private readonly filePath: string) {}

  get(conversationId: string): MemoryExtractionState | null {
    return this.read().sessions[String(conversationId ?? "").trim()] ?? null;
  }

  set(conversationId: string, state: MemoryExtractionState): void {
    const id = String(conversationId ?? "").trim();
    if (!id) return;
    const file = this.read();
    file.sessions[id] = state;
    this.write(file);
  }

  delete(conversationId: string): void {
    const id = String(conversationId ?? "").trim();
    const file = this.read();
    if (!file.sessions[id]) return;
    delete file.sessions[id];
    this.write(file);
  }

  private read(): MemoryExtractionStateFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<MemoryExtractionStateFile>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.sessions !== "object" || !parsed.sessions) {
        return { ...EMPTY, sessions: {} };
      }
      return { version: 1, sessions: { ...parsed.sessions } };
    } catch {
      // A missing or corrupt watermark must not stop extraction; it only means
      // the next sweep re-reads the tail and relies on write-path dedupe.
      return { ...EMPTY, sessions: {} };
    }
  }

  private write(file: MemoryExtractionStateFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file)}\n`, "utf8");
    renameSync(temp, this.filePath);
  }
}

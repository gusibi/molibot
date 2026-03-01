import type {
  MemoryAddInput,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult
} from "./types.js";

export interface MemoryImportSink {
  add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord>;
  search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]>;
}

export interface MemoryImporter {
  key: string;
  name: string;
  description: string;
  sync(sink: MemoryImportSink): Promise<MemorySyncResult>;
}

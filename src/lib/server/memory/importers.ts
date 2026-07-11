import type {
  MemoryAddInput,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySyncResult
} from "$lib/server/memory/types.js";

export interface MemoryImportSink {
  add(scope: MemoryScope, input: MemoryAddInput): Promise<void>;
  search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]>;
}

export interface MemoryImporter {
  key: string;
  name: string;
  description: string;
  sync(sink: MemoryImportSink): Promise<MemorySyncResult>;
}

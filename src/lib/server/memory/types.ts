export interface MemoryScope {
  channel: string;
  externalUserId: string;
}

export type MemoryLayer = "long_term" | "daily";
export type MemorySearchMode = "keyword" | "recent" | "hybrid";

export interface MemoryRecord {
  id: string;
  channel: string;
  externalUserId: string;
  content: string;
  tags: string[];
  layer: MemoryLayer;
  factKey?: string;
  hasConflict?: boolean;
  sourceSessionId?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryAddInput {
  content: string;
  tags?: string[];
  layer?: MemoryLayer;
  sourceSessionId?: string;
  expiresAt?: string;
}

export interface MemoryUpdateInput {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
}

export interface MemorySearchInput {
  query: string;
  limit?: number;
  mode?: MemorySearchMode;
}

export interface MemoryFlushResult {
  scannedMessages: number;
  addedCount: number;
  memories: MemoryRecord[];
  updatedCursorConversations: number;
}

export interface MemorySyncResult {
  scannedFiles: number;
  importedCount: number;
}

export interface MemoryBackendCapabilities {
  supportsHybridSearch: boolean;
  supportsVectorSearch: boolean;
  supportsIncrementalFlush: boolean;
  supportsLayeredMemory: boolean;
}

export interface MemoryBackend {
  capabilities(): MemoryBackendCapabilities;
  add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord>;
  search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]>;
  searchAll(input: MemorySearchInput): Promise<MemoryRecord[]>;
  delete(scope: MemoryScope, id: string): Promise<boolean>;
  update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null>;
  flush(scope: MemoryScope): Promise<MemoryFlushResult>;
}

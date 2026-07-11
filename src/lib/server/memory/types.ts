export interface MemoryScope {
  channel: string;
  externalUserId: string;
  botId?: string;
  ownerId?: string;
  projectId?: string;
  shareOwner?: boolean;
}

export type MemoryLayer = "long_term" | "daily";
export type MemorySearchMode = "keyword" | "recent" | "hybrid";
export type MemoryDomain = "owner" | "project" | "agent_self" | "content";
export type MemorySemanticType = "user_preference" | "user_fact" | "skill" | "event" | "task" | "world_knowledge";
export type MemoryNamespace = `owner:${string}` | `chat:${string}:${string}:${string}` | `project:${string}:${string}` | `agent:${string}` | `content:${string}`;

export interface MemorySourceRef {
  channel: string;
  sessionId: string;
  conversationMessageId: string;
  platformMessageId?: string;
}

export interface MemoryRecord {
  id: string;
  channel: string;
  externalUserId: string;
  content: string;
  tags: string[];
  layer: MemoryLayer;
  namespace?: MemoryNamespace;
  domain?: MemoryDomain;
  type?: MemorySemanticType;
  subject?: string;
  path?: string;
  lowConfidencePath?: boolean;
  confidence?: number;
  reason?: string;
  sources?: MemorySourceRef[];
  pinned?: boolean;
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
  namespace?: MemoryNamespace;
  domain?: MemoryDomain;
  type?: MemorySemanticType;
  subject?: string;
  confidence?: number;
  reason?: string;
  sources?: MemorySourceRef[];
  pinned?: boolean;
}

export type MemoryCandidateStatus = "pending" | "confirmed" | "ignored" | "edited-then-confirmed";

export interface MemoryCandidate {
  id: string;
  fingerprint: string;
  runKey?: string;
  namespace: MemoryNamespace;
  domain: MemoryDomain;
  type: MemorySemanticType;
  subject: string;
  path: string;
  value: string;
  confidence: number;
  reason: string;
  sources: MemorySourceRef[];
  layer: MemoryLayer;
  expiresAt?: string;
  pinned?: boolean;
  status: MemoryCandidateStatus;
  confirmedMemoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCandidateCreateInput = Omit<MemoryCandidate, "id" | "fingerprint" | "status" | "confirmedMemoryId" | "createdAt" | "updatedAt"> & { fingerprint?: string };
export type MemoryCandidateEdit = Partial<Pick<MemoryCandidate, "namespace" | "domain" | "type" | "subject" | "value" | "confidence" | "reason" | "sources" | "layer" | "expiresAt" | "pinned">>;

export interface MemoryUpdateInput {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  pinned?: boolean;
}

export interface MemorySearchInput {
  query: string;
  limit?: number;
  mode?: MemorySearchMode;
}

export interface MemoryPromptSnapshot {
  createdAt: string;
  scope: MemoryScope;
  query: string;
  fingerprint: string;
  promptText: string;
  longTerm: MemoryRecord[];
  daily: MemoryRecord[];
  selected: MemoryRecord[];
}

export interface MemoryFlushResult {
  scannedMessages: number;
  addedCount: number;
  memories: MemoryRecord[];
  updatedCursorConversations: number;
}

export interface MemoryCompactResult {
  scannedCount: number;
  removedCount: number;
  scopesAffected: number;
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
  supportsDomains?: boolean;
  supportsVersioning?: boolean;
  supportsCandidates?: boolean;
}

export interface MemoryBackend {
  capabilities(): MemoryBackendCapabilities;
  get(scope: MemoryScope, id: string): Promise<MemoryRecord | null>;
  add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord>;
  search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]>;
  searchNamespaces?(namespaces: MemoryNamespace[], scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]>;
  versions?(scope: MemoryScope, id: string): Promise<MemoryRecord[]>;
  configureEmbedder?(embedder?: (text: string) => Promise<number[]>, modelVersion?: string): void;
  backfillEmbeddings?(limit?: number): Promise<{ scannedCount: number; updatedCount: number; remainingCount: number }>;
  searchAll(input: MemorySearchInput): Promise<MemoryRecord[]>;
  delete(scope: MemoryScope, id: string): Promise<boolean>;
  update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null>;
  flush(scope: MemoryScope): Promise<MemoryFlushResult>;
  compact(scope?: MemoryScope): Promise<MemoryCompactResult>;
}

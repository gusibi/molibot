import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MemoryGateway } from "./gateway.js";
import type { MemoryBackend } from "./types.js";

test("rotating an embedding API key reconfigures the backend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-embedding-config-"));
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  let embedder: ((text: string) => Promise<number[]>) | undefined;
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: Boolean(embedder), supportsIncrementalFlush: true, supportsLayeredMemory: true }),
    configureEmbedder: (next) => { embedder = next; },
    add: async () => { throw new Error("unused"); }, get: async () => null, search: async () => [], searchAll: async () => [], delete: async () => false, update: async () => null,
    flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }), compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  let apiKey = "old-secret";
  const settings = () => ({
    plugins: { memory: { enabled: true, backend: "mory", embeddingProviderId: "provider", embeddingModel: "embed-v1" } },
    customProviders: [{ id: "provider", enabled: true, baseUrl: "https://embedding.invalid/v1", apiKey }]
  }) as any;
  const gateway = new MemoryGateway(settings, {} as any, undefined, {
    candidateStore: candidates, backends: { mory: backend },
    backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: []
  });
  const originalFetch = globalThis.fetch;
  const authorizations: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
    return new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    gateway.capabilities();
    await embedder?.("first");
    apiKey = "new-secret";
    gateway.capabilities();
    await embedder?.("second");
    assert.deepEqual(authorizations, ["Bearer old-secret", "Bearer new-secret"]);
  } finally {
    globalThis.fetch = originalFetch;
    candidates.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

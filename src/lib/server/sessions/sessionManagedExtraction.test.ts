import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { SessionExtractionStore } from "$lib/server/sessions/sessionExtractionStore.js";
import {
  SessionExtractionService,
  type ExtractionOutput
} from "$lib/server/sessions/sessionExtractionService.js";
import type { MemoryCandidate, MemoryCandidateCreateInput } from "$lib/server/memory/types.js";

const OWNER = "web:personal:web-anonymous";

/** Minimal deterministic gateway: auto-confirms every valid candidate. */
class StubGateway {
  private seq = 0;

  createCandidate(input: MemoryCandidateCreateInput): MemoryCandidate | null {
    this.seq += 1;
    const now = new Date().toISOString();
    return {
      ...input,
      value: String(input.value),
      id: `cand-${this.seq}`,
      fingerprint: `fp-${this.seq}`,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
  }

  async maybeAutoConfirmCandidate(id: string): Promise<MemoryCandidate | null> {
    this.seq += 1;
    const base = { id } as MemoryCandidate;
    return { ...base, status: "confirmed", confirmedMemoryId: `mem-${this.seq}` } as MemoryCandidate;
  }
}

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  extractionStore: SessionExtractionStore;
  outputs: Map<string, ExtractionOutput | null | unknown>;
  extraction(): SessionExtractionService;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-managed-extract-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile,
    projectsDir: storagePaths.projectsDir
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  storagePaths.projectsDir = path.join(root, "projects");

  const sessions = new SessionStore();
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"));
  const extractionStore = new SessionExtractionStore(path.join(root, "extraction.db"));
  const service = new SessionLifecycleService({ sessions, lifecycle, extraction: extractionStore });
  sessions.setSessionActivitySink(service);
  const gateway = new StubGateway();
  const outputs = new Map<string, ExtractionOutput | null | unknown>();
  const fx: Fixture = {
    root,
    sessions,
    lifecycle,
    service,
    extractionStore,
    outputs,
    extraction() {
      return new SessionExtractionService({
        sessions,
        lifecycle: service,
        lifecycleRows: lifecycle,
        store: extractionStore,
        gateway,
        extractor: async (input) => {
          if (!outputs.has(input.conversationId)) return { noUsefulInformation: true };
          return outputs.get(input.conversationId) as ExtractionOutput;
        },
        ownerId: "owner",
        botId: "web"
      });
    },
    cleanup() {
      try { extractionStore.close(); } catch { /* ignore */ }
      try { lifecycle.close(); } catch { /* ignore */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
  return fx;
}

function createWithMessages(fx: Fixture, messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  const conversation = fx.sessions.createWebConversation(OWNER);
  for (const message of messages) {
    fx.sessions.appendMessage(conversation.id, message.role, message.content);
  }
  return conversation.id;
}

test("managed items default to unprocessed with no source range", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const id = createWithMessages(fx, [{ role: "user", content: "hello" }]);

  const item = fx.service.queryManaged({}).items.find((entry) => entry.conversationId === id)!;
  assert.ok(item);
  assert.equal(item.extractionStatus, "unprocessed");
  assert.equal(item.processedThroughId, null);
  assert.equal(item.extractionRevision, null);
  assert.deepEqual(item.savedMemoryIds, []);
  assert.deepEqual(item.savedDocRefs, []);
});

test("saved extraction surfaces status, exact source range and retained memory links", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const id = createWithMessages(fx, [{ role: "user", content: "I prefer dark mode" }]);
  fx.outputs.set(id, {
    memories: [{ domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user prefers dark mode" }]
  });

  const result = await fx.extraction().extract({ conversationId: id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "saved");

  const item = fx.service.queryManaged({}).items.find((entry) => entry.conversationId === id)!;
  assert.equal(item.extractionStatus, "saved");
  assert.equal(item.extractionRevision, result.messageRevision);
  assert.equal(item.processedThroughId, result.processedThroughId);
  assert.deepEqual(item.savedMemoryIds, result.savedMemoryIds);
  assert.ok(item.savedMemoryIds.length === 1);
});

test("later messages turn a saved session partially processed again", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const id = createWithMessages(fx, [{ role: "user", content: "I prefer dark mode" }]);
  fx.outputs.set(id, {
    memories: [{ domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user prefers dark mode" }]
  });
  assert.equal((await fx.extraction().extract({ conversationId: id, requesterExternalUserId: OWNER })).status, "saved");
  assert.equal(
    fx.service.queryManaged({}).items.find((entry) => entry.conversationId === id)?.extractionStatus,
    "saved"
  );

  fx.sessions.appendMessage(id, "user", "actually I also like light themes now");

  assert.equal(
    fx.service.queryManaged({}).items.find((entry) => entry.conversationId === id)?.extractionStatus,
    "partially-processed"
  );
});

test("extractionStates filter selects the matching subset", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const saved = createWithMessages(fx, [{ role: "user", content: "I prefer dark mode" }]);
  const untouched = createWithMessages(fx, [{ role: "user", content: "just chatting" }]);
  fx.outputs.set(saved, {
    memories: [{ domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user prefers dark mode" }]
  });
  await fx.extraction().extract({ conversationId: saved, requesterExternalUserId: OWNER });

  const onlySaved = fx.service.queryManaged({ extractionStates: ["saved"] });
  assert.deepEqual(onlySaved.items.map((item) => item.conversationId), [saved]);
  const onlyUnprocessed = fx.service.queryManaged({ extractionStates: ["unprocessed"] });
  assert.ok(onlyUnprocessed.items.some((item) => item.conversationId === untouched));
  assert.ok(!onlyUnprocessed.items.some((item) => item.conversationId === saved));
});

test("processedNotArchived filter shows remaining cleanup work only", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const done = createWithMessages(fx, [{ role: "user", content: "I prefer dark mode" }]);
  const untouched = createWithMessages(fx, [{ role: "user", content: "just chatting" }]);
  fx.outputs.set(done, {
    memories: [{ domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user prefers dark mode" }]
  });
  await fx.extraction().extract({ conversationId: done, requesterExternalUserId: OWNER });

  let filtered = fx.service.queryManaged({ processedNotArchived: true });
  assert.deepEqual(filtered.items.map((item) => item.conversationId), [done]);

  assert.equal(fx.service.archive({ conversationId: done }).status, "succeeded");
  filtered = fx.service.queryManaged({ processedNotArchived: true });
  assert.ok(!filtered.items.some((item) => item.conversationId === done));
  assert.ok(!filtered.items.some((item) => item.conversationId === untouched));
});

test("failed and no-useful-information receipts are observable in the list", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const broken = createWithMessages(fx, [{ role: "user", content: "hello" }]);
  const empty = createWithMessages(fx, [{ role: "user", content: "hi there" }]);
  fx.outputs.set(broken, null);
  await fx.extraction().extract({ conversationId: broken, requesterExternalUserId: OWNER });
  await fx.extraction().extract({ conversationId: empty, requesterExternalUserId: OWNER });

  const items = fx.service.queryManaged({}).items;
  assert.equal(items.find((item) => item.conversationId === broken)?.extractionStatus, "failed");
  assert.equal(items.find((item) => item.conversationId === empty)?.extractionStatus, "no-useful-information");
  // A malformed model response is a failure, never proof of nothing-to-save.
  const failedOnly = fx.service.queryManaged({ extractionStates: ["failed"] });
  assert.ok(failedOnly.items.some((item) => item.conversationId === broken));
  assert.ok(!failedOnly.items.some((item) => item.conversationId === empty));
});

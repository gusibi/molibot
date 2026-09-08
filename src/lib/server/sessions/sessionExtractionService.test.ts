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
import { SessionExtractionService, type ExtractionOutput } from "$lib/server/sessions/sessionExtractionService.js";
import { MemoryCandidateValidationError } from "$lib/server/memory/gateway.js";
import { candidateFingerprint, candidateSuppressionKey } from "$lib/server/memory/candidateStore.js";
import { agentNamespace, ownerNamespace, projectNamespace } from "$lib/server/memory/namespaces.js";
import { resolveSessionEvidence } from "$lib/server/sessions/sessionEvidence.js";
import type { MemoryCandidate, MemoryCandidateCreateInput } from "$lib/server/memory/types.js";

const OWNER = "web:personal:web-anonymous";
const BOT_ID = "web";

/** Deterministic stub gateway: reuses real validation + fingerprint + suppression-key behavior. */
class FakeGateway {
  candidates = new Map<string, MemoryCandidate>();
  byFingerprint = new Map<string, MemoryCandidate>();
  createCalls: MemoryCandidateCreateInput[] = [];
  mode: "auto-confirm" | "pending" = "auto-confirm";
  privacySuppressedKeys = new Set<string>();
  private seq = 0;

  createCandidate(input: MemoryCandidateCreateInput): MemoryCandidate | null {
    const value = String(input.value ?? "").trim();
    if (!value) throw new MemoryCandidateValidationError("Candidate value is required.");
    if (!input.namespace || !input.domain || !input.type || !String(input.subject ?? "").trim()) {
      throw new MemoryCandidateValidationError("Candidate namespace, domain, type, and subject are required.");
    }
    const expectedPrefix =
      input.domain === "owner" ? "owner:"
      : input.domain === "project" ? "project:"
      : input.domain === "agent_self" ? "agent:"
      : "content:";
    if (!input.namespace.startsWith(expectedPrefix)) {
      throw new MemoryCandidateValidationError(`Candidate namespace does not match domain '${input.domain}'.`);
    }
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new MemoryCandidateValidationError("Candidate sources require channel, sessionId, and conversationMessageId.");
    }
    if (this.isPrivacySuppressed(input)) return null;
    this.createCalls.push(input);
    const fingerprint = input.fingerprint || candidateFingerprint(input);
    const existing = this.byFingerprint.get(fingerprint);
    if (existing) return null;
    this.seq += 1;
    const now = new Date().toISOString();
    const candidate: MemoryCandidate = {
      ...input,
      value,
      id: `cand-${this.seq}`,
      fingerprint,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.candidates.set(candidate.id, candidate);
    this.byFingerprint.set(fingerprint, candidate);
    return candidate;
  }

  async maybeAutoConfirmCandidate(id: string): Promise<MemoryCandidate | null> {
    const candidate = this.candidates.get(id);
    if (!candidate) return null;
    if (this.mode === "pending") return { ...candidate, status: "pending" };
    this.seq += 1;
    const confirmed: MemoryCandidate = {
      ...candidate,
      status: "confirmed",
      confirmedMemoryId: `mem-${this.seq}`
    };
    this.candidates.set(id, confirmed);
    this.byFingerprint.set(candidate.fingerprint, confirmed);
    return confirmed;
  }

  getCandidate(id: string): MemoryCandidate | null {
    return this.candidates.get(id) ?? null;
  }

  isPrivacySuppressed(
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">
  ): boolean {
    return this.privacySuppressedKeys.has(candidateSuppressionKey(input));
  }

  suppressValue(input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">): void {
    this.privacySuppressedKeys.add(candidateSuppressionKey(input));
  }
}

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  lifecycleService: SessionLifecycleService;
  extractionStore: SessionExtractionStore;
  gateway: FakeGateway;
  outputs: Map<string, ExtractionOutput | null | unknown>;
  extractorCalls: string[];
  saverCalls: Array<{ conversationId: string; title: string; content: string }>;
  saveBehavior: "ok" | "throw";
  docSeq: { value: number };
  originals: Record<string, string>;
  service(): SessionExtractionService;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-extract-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

  const sessions = new SessionStore();
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"));
  const lifecycleService = new SessionLifecycleService({ sessions, lifecycle });
  sessions.setSessionActivitySink(lifecycleService);
  const extractionStore = new SessionExtractionStore(path.join(root, "extraction.db"));
  const gateway = new FakeGateway();
  const outputs = new Map<string, ExtractionOutput | null | unknown>();
  const extractorCalls: string[] = [];
  const saverCalls: Array<{ conversationId: string; title: string; content: string }> = [];
  const saveBehavior = "ok";
  const docSeq = { value: 0 };
  const fx: Fixture = {
    root,
    sessions,
    lifecycle,
    lifecycleService,
    extractionStore,
    gateway,
    outputs,
    extractorCalls,
    saverCalls,
    saveBehavior: saveBehavior as Fixture["saveBehavior"],
    docSeq,
    originals,
    service() {
      return new SessionExtractionService({
        sessions,
        lifecycle: lifecycleService,
        lifecycleRows: lifecycle,
        store: extractionStore,
        gateway,
        extractor: async (input) => {
          extractorCalls.push(input.conversationId);
          if (!outputs.has(input.conversationId)) return { noUsefulInformation: true };
          return outputs.get(input.conversationId) as ExtractionOutput;
        },
        documentSaver: {
          save: async (input) => {
            saverCalls.push(input);
            if (fx.saveBehavior === "throw") throw new Error("document save failed");
            fx.docSeq.value += 1;
            return { docId: `doc-${fx.docSeq.value}` };
          }
        },
        ownerId: "owner",
        botId: BOT_ID
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

test("owner preference lands in the owner namespace", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const result = await fx.service().extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "saved");
  assert.equal(result.savedMemoryIds.length, 1);
  const sent = fx.gateway.createCalls[0];
  assert.ok(sent);
  assert.equal(sent.namespace, ownerNamespace("owner"));
  assert.equal(sent.domain, "owner");
});

test("project fact stays project-scoped and never leaks to the owner namespace", async (t) => {  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createProjectConversation("proj-1", OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "Project decision: migrate the API to version two next sprint");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "project", type: "event", subject: "api_migration", value: "Project proj-1 decided to migrate the API to version two next sprint" }
    ]
  });

  const result = await fx.service().extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "saved");
  const sent = fx.gateway.createCalls[0];
  assert.ok(sent);
  assert.ok(sent.namespace.startsWith("project:"), `expected project namespace, got ${sent.namespace}`);
  assert.ok(!sent.namespace.startsWith("owner:"), "project fact must not leak into the owner namespace");
  assert.equal(sent.namespace, projectNamespace({ channel: "web", externalUserId: OWNER, ownerId: "owner", projectId: "proj-1" }));
});

test("S2: agent_self memories route to the session's BOT namespace, not the service default", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const otherOwner = "web:work:web-anonymous";
  const first = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(first.id, "user", "The assistant helped me debug the deploy script");
  const second = fx.sessions.createWebConversation(otherOwner);
  fx.sessions.appendMessage(second.id, "user", "The assistant helped me plan the launch checklist");
  for (const id of [first.id, second.id]) {
    fx.outputs.set(id, {
      memories: [
        { domain: "agent_self", type: "skill", subject: "debug_help", value: "The assistant is good at debugging deploy scripts" }
      ]
    });
  }

  const service = fx.service();
  const one = await service.extract({ conversationId: first.id, requesterExternalUserId: OWNER });
  const two = await service.extract({ conversationId: second.id, requesterExternalUserId: otherOwner });
  assert.equal(one.status, "saved");
  assert.equal(two.status, "saved");
  assert.equal(fx.gateway.createCalls[0]?.namespace, agentNamespace("personal"));
  assert.equal(fx.gateway.createCalls[1]?.namespace, agentNamespace("work"));
  assert.equal(fx.extractionStore.get(first.id)?.botId, "personal");
  assert.equal(fx.extractionStore.get(second.id)?.botId, "work");
});

test("turn-retention restricted turns are never promoted into durable output", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "My public favorite color is clearly blue and green");
  fx.sessions.appendMessage(conversation.id, "user", "SECRET-XYZ do not remember this passphrase", { retention: "no_memory" });
  let seenMessages: Array<{ content: string }> = [];
  const service = new SessionExtractionService({
    sessions: fx.sessions,
    lifecycle: fx.lifecycleService,
    lifecycleRows: fx.lifecycle,
    store: fx.extractionStore,
    gateway: fx.gateway,
    extractor: async (input) => {
      seenMessages = input.messages;
      return {
        memories: input.messages.map((message, index) => ({
          domain: "owner" as const,
          type: "user_preference" as const,
          subject: `note_${index}`,
          value: `Extracted durable note: ${message.content}`
        }))
      };
    },
    ownerId: "owner",
    botId: BOT_ID
  });

  const result = await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "saved");
  assert.ok(!seenMessages.some((message) => message.content.includes("SECRET-XYZ")), "restricted turn reached the extractor");
  for (const call of fx.gateway.createCalls) {
    assert.ok(!call.value.includes("SECRET-XYZ"), "restricted turn was promoted into durable memory");
  }
});

test("explicit no-useful-information archives via extract-and-archive", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "ok thanks bye");
  fx.outputs.set(conversation.id, { noUsefulInformation: true });

  const result = await fx.service().extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "no-useful-information");
  assert.equal(result.archived, true);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "archived");
});

test("empty model response is not proof of nothing-to-save", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "Remember that I strongly prefer dark mode everywhere");
  fx.outputs.set(conversation.id, { memories: [] });

  const result = await fx.service().extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "failed");
  assert.equal(result.archived, false);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "active");
});

test("malformed item fails the job but keeps the saved sibling", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode and light breakfast menus");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode in the application" },
      { domain: "owner", type: "user_preference", subject: "broken_item", value: "   " }
    ]
  });

  const result = await fx.service().extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "failed");
  assert.equal(result.savedMemoryIds.length, 1);
  assert.ok(result.failureReasons.length > 0);
});

test("pending candidates are not saved and block archiving", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  fx.gateway.mode = "pending";
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const result = await fx.service().extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "pending-review");
  assert.equal(result.savedMemoryIds.length, 0);
  assert.equal(result.pendingCandidateIds.length, 1);
  assert.equal(result.archived, false);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "active");
});

test("failed artifact save keeps sibling memories and blocks archiving", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  fx.saveBehavior = "throw";
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "Final report draft: quarterly numbers look great overall");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_fact", subject: "quarterly_numbers", value: "Quarterly numbers were reported as looking great overall" }
    ],
    artifactSaves: [{ title: "Quarterly report", content: "Quarterly numbers look great overall, full draft body here" }]
  });

  const result = await fx.service().extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "failed");
  assert.equal(result.savedMemoryIds.length, 1);
  assert.equal(result.archived, false);
});

test("artifact links are recorded without copying the work product", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "See the finished design artifact for review today");
  fx.outputs.set(conversation.id, { artifactLinks: [{ artifactId: "artifact-1", title: "Finished design" }] });

  const result = await fx.service().extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.status, "saved");
  assert.deepEqual(result.savedDocRefs, [{ docId: "artifact-1", title: "Finished design" }]);
  assert.equal(fx.saverCalls.length, 0);
});

test("retry on the same revision is idempotent: no duplicate memories", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const service = fx.service();
  const first = await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  const second = await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(first.status, "saved");
  assert.equal(second.status, "saved");
  assert.equal(fx.extractorCalls.length, 1);
  assert.equal(fx.gateway.createCalls.length, 1);
  assert.equal(fx.gateway.byFingerprint.size, 1);
});

test("new messages after extraction make the session partially processed", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const service = fx.service();
  assert.equal((await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER })).status, "saved");
  fx.sessions.appendMessage(conversation.id, "user", "Also I strongly prefer morning standup meetings now");
  assert.equal(service.getStatus({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "partially-processed");
});

test("memory deletion suppression is honored: forbidden items are never recreated", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.gateway.suppressValue({
    namespace: ownerNamespace("owner"),
    domain: "owner",
    type: "user_preference",
    subject: "ui_theme",
    value: "The user strongly prefers dark mode everywhere in the app"
  });
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const result = await fx.service().extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(fx.gateway.byFingerprint.size, 0);
  assert.ok(result.status === "saved" || result.status === "no-useful-information");
  assert.equal(result.archived, true);
});

test("concurrent messages during extraction block archiving but keep saved work", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  const service = new SessionExtractionService({
    sessions: fx.sessions,
    lifecycle: fx.lifecycleService,
    lifecycleRows: fx.lifecycle,
    store: fx.extractionStore,
    gateway: fx.gateway,
    extractor: async () => {
      fx.sessions.appendMessage(conversation.id, "user", "A concurrent message just arrived mid-run here");
      return {
        memories: [
          { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
        ]
      };
    },
    ownerId: "owner",
    botId: BOT_ID
  });

  const result = await service.extractAndArchive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(result.savedMemoryIds.length, 1);
  assert.equal(result.archived, false);
  assert.ok(result.archiveReason?.includes("concurrent") || result.archiveReason?.includes("version") || result.archiveReason?.includes("message"));
});

test("extraction receipts survive store restart", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode everywhere in the app");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode everywhere in the app" }
    ]
  });

  const service = fx.service();
  assert.equal((await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER })).status, "saved");
  const dbFile = path.join(fx.root, "extraction.db");
  fx.extractionStore.close();
  const reopened = new SessionExtractionStore(dbFile);
  t.after(() => reopened.close());
  const revived = new SessionExtractionService({
    sessions: fx.sessions,
    lifecycle: fx.lifecycleService,
    lifecycleRows: fx.lifecycle,
    store: reopened,
    gateway: fx.gateway,
    extractor: async () => { throw new Error("must not re-extract a completed revision"); },
    ownerId: "owner",
    botId: BOT_ID
  });
  assert.equal(revived.getStatus({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "saved");
});

test("failed retry unions previously saved references instead of erasing them", async (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "I strongly prefer dark mode and quiet mornings");
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode in the application" },
      { domain: "owner", type: "user_preference", subject: "broken_item", value: "   " }
    ]
  });

  const service = fx.service();
  const first = await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(first.status, "failed");
  assert.equal(first.savedMemoryIds.length, 1);
  fx.outputs.set(conversation.id, {
    memories: [
      { domain: "owner", type: "user_preference", subject: "ui_theme", value: "The user strongly prefers dark mode in the application" },
      { domain: "owner", type: "user_preference", subject: "mornings", value: "The user strongly prefers quiet mornings for focused work" }
    ]
  });
  const second = await service.extract({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(second.status, "saved");
  assert.equal(second.savedMemoryIds.length, 2);
  assert.equal(new Set(second.savedMemoryIds).size, 2);
});

test("purged sources render as source-unavailable instead of crashing", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "evidence content for later receipt linking");
  const messages = fx.sessions.listMessageMetadata(conversation.id);
  assert.ok(messages.length > 0);
  fx.sessions.deleteConversation(conversation.id, "web", OWNER);
  const evidence = resolveSessionEvidence(fx.sessions, conversation.id, messages[0]?.id);
  assert.equal(evidence.status, "source-unavailable");
});

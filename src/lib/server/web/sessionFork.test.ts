import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { forkSessionWith, sessionForkId } from "$lib/server/web/sessionFork.js";

function message(role: "user" | "assistant", text: string): AgentMessage {
  return { role, content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

test("forkSessionWith creates one restart-safe child and preserves the parent", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-session-fork-"));
  const original = { ...storagePaths };
  try {
    storagePaths.webWorkspaceDir = join(root, "web");
    storagePaths.sessionsDir = join(root, "legacy");
    storagePaths.sessionsIndexFile = join(root, "legacy-index.json");
    const owner = "web:personal:web-anonymous";
    const sessions = new SessionStore();
    const parent = sessions.createWebConversation(owner);
    const agent = new MomRuntimeStore(join(root, "agent"));
    const firstUserEntry = agent.appendContextMessage(owner, message("user", "first"), parent.id);
    const firstAssistantEntry = agent.appendContextMessage(owner, message("assistant", "answer"), parent.id);
    const secondUserEntry = agent.appendContextMessage(owner, message("user", "second"), parent.id);
    agent.appendContextMessage(owner, message("assistant", "second answer"), parent.id);
    sessions.appendMessage(parent.id, "user", "first", { contextBacked: true, sourceEntryId: firstUserEntry });
    sessions.appendMessage(parent.id, "assistant", "answer", { contextBacked: true, sourceEntryId: firstAssistantEntry });
    const secondUser = sessions.appendMessage(parent.id, "user", "second", { contextBacked: true, sourceEntryId: secondUserEntry });
    sessions.appendMessage(parent.id, "assistant", "second answer", { contextBacked: true });
    const childId = sessionForkId(parent.id, secondUser.id, "request-1");
    assert.match(childId, /^s-\d{8}-[a-z]{4}$/);
    const pool = {
      get: () => ({ isRunning: () => false }),
      reset: () => {}
    };

    const result = forkSessionWith(
      { sessions, store: agent, pool },
      { owner, chatId: owner, sourceSessionId: parent.id, fromMessageId: secondUser.id, childSessionId: childId }
    );

    assert.equal(result.status, "created");
    assert.equal(sessions.listMessages(parent.id).length, 4);
    // Inclusive of the fork point across BOTH stores, or the visible transcript
    // and the model context would disagree about where the child starts.
    assert.deepEqual(new SessionStore().listMessages(childId).map((item) => item.content), ["", "", ""]);
    assert.deepEqual(new MomRuntimeStore(join(root, "agent")).loadContext(owner, childId).map((item) => item.role), ["user", "assistant", "user"]);
    assert.equal(new SessionStore().getConversationById(childId, "web", owner)?.parentSessionId, parent.id);

    const repeated = forkSessionWith(
      { sessions: new SessionStore(), store: new MomRuntimeStore(join(root, "agent")), pool },
      { owner, chatId: owner, sourceSessionId: parent.id, fromMessageId: secondUser.id, childSessionId: childId }
    );
    assert.equal(repeated.status, "existing");
    assert.equal(new SessionStore().listConversations("web", owner).filter((item) => item.id === childId).length, 1);

    assert.equal(sessions.deleteConversation(parent.id, "web", owner), true);
    assert.equal(agent.deleteSessionArtifacts(owner, parent.id), true);
    assert.equal(new SessionStore().getConversationById(childId, "web", owner)?.parentSessionId, parent.id);
    assert.deepEqual(new MomRuntimeStore(join(root, "agent")).loadContext(owner, childId).map((item) => item.role), ["user", "assistant", "user"]);
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});

test("forkSessionWith rejects running sources and compensates a visible-store failure", () => {
  let agentForks = 0;
  let agentDeletes = 0;
  const base = {
    sessions: {
      getForkableConversation: (id: string) => id === "source" ? {
        conversation: {
          id, channel: "web", externalUserId: "owner", title: "Source", createdAt: "now", updatedAt: "now"
        },
        kind: "web"
      } : null,
      listMessageMetadata: () => [{
        id: "message",
        conversationId: "source",
        role: "user",
        createdAt: "2026-07-26T00:00:00.000Z",
        contextBacked: true,
        sourceEntryId: "entry"
      }],
      markMessagesContextBacked: () => {},
      recordMessageSourceEntries: () => {},
      forkConversationBeforeMessage: () => { throw new Error("visible write failed"); }
    },
    store: {
      listSessionMessageEntries: () => [{
        type: "message",
        id: "entry",
        parentId: null,
        timestamp: "2026-07-26T00:00:00.000Z",
        message: message("user", "fork here")
      }],
      forkSessionBeforeEntry: () => { agentForks += 1; return "child"; },
      deleteSessionArtifacts: () => { agentDeletes += 1; return true; }
    }
  } as any;

  const running = forkSessionWith(
    { ...base, pool: { get: () => ({ isRunning: () => true }), reset: () => {} } },
    { owner: "owner", chatId: "owner", sourceSessionId: "source", fromMessageId: "message", childSessionId: "child" }
  );
  assert.equal(running.status, "running");
  assert.equal(agentForks, 0);
  assert.equal(agentDeletes, 0);

  assert.throws(
    () => forkSessionWith(
      { ...base, pool: { get: () => ({ isRunning: () => false }), reset: () => {} } },
      { owner: "owner", chatId: "owner", sourceSessionId: "source", fromMessageId: "message", childSessionId: "child" }
    ),
    /visible write failed/
  );
  assert.equal(agentForks, 1);
  assert.equal(agentDeletes, 1);
});

test("forkSessionWith treats a concurrent matching visible child as idempotent success", () => {
  let visibleChild = false;
  let agentDeletes = 0;
  const child = {
    id: "child",
    channel: "web" as const,
    externalUserId: "owner",
    title: "Source",
    createdAt: "now",
    updatedAt: "now",
    parentSessionId: "source",
    forkedFromMessageId: "message"
  };
  const sessions = {
    getForkableConversation: (id: string) => {
      if (id === "source") {
        return { conversation: { ...child, id: "source", parentSessionId: undefined, forkedFromMessageId: undefined }, kind: "web" };
      }
      return id === "child" && visibleChild ? { conversation: child, kind: "web" } : null;
    },
    listMessageMetadata: () => [{
      id: "message",
      conversationId: "source",
      role: "user",
      createdAt: "2026-07-26T00:00:00.000Z",
      contextBacked: true,
      sourceEntryId: "entry"
    }],
    markMessagesContextBacked: () => {},
    recordMessageSourceEntries: () => {},
    forkConversationBeforeMessage: () => {
      visibleChild = true;
      const error = new Error("already exists") as Error & { code?: string };
      error.code = "SESSION_EXISTS";
      throw error;
    }
  } as any;
  const store = {
    listSessionMessageEntries: () => [{
      type: "message",
      id: "entry",
      parentId: null,
      timestamp: "2026-07-26T00:00:00.000Z",
      message: message("user", "fork here")
    }],
    forkSessionBeforeEntry: () => "child",
    deleteSessionArtifacts: () => { agentDeletes += 1; return true; }
  } as any;

  const result = forkSessionWith(
    { sessions, store, pool: { get: () => ({ isRunning: () => false }), reset: () => {} } },
    { owner: "owner", chatId: "owner", sourceSessionId: "source", fromMessageId: "message", childSessionId: "child" }
  );

  assert.equal(result.status, "existing");
  assert.equal(agentDeletes, 0);
});

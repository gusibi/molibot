import test from "node:test";
import assert from "node:assert/strict";
import { ReflectionStateStore, SessionReflectionSourceReader, type ReflectionTarget } from "./reflection.js";

function target(): ReflectionTarget {
  return {
    ownerId: "owner",
    botId: "momo",
    timezone: "Asia/Shanghai",
    sourceScopes: [{ channel: "web", externalUserId: "profile-1", botId: "momo" }]
  };
}

function sessionsStub() {
  const base = { conversationId: "session-trash", role: "user" as const, createdAt: "2026-08-09T02:00:00.000Z" };
  return {
    listConversations: () => [{ id: "session-trash" }, { id: "session-live" }],
    listProjectConversations: () => [],
    listMessages: (conversationId: string) => [
      { ...base, conversationId, id: `msg-${conversationId}`, content: `content of ${conversationId}` }
    ]
  };
}

test("trashed sessions are excluded from reflection inputs", async () => {
  const state = new ReflectionStateStore(":memory:");
  try {
    const reader = new SessionReflectionSourceReader(
      sessionsStub() as any,
      state,
      undefined,
      undefined,
      undefined,
      (conversationId) => conversationId === "session-trash"
    );
    const projections = await reader.read(target(), "2026-08-09");
    assert.deepEqual(projections.map((projection) => projection.conversationId), ["session-live"]);
  } finally {
    state.close();
  }
});

test("trashed sessions do not move the earliest backfill date", () => {
  const state = new ReflectionStateStore(":memory:");
  try {
    const liveOnly = new SessionReflectionSourceReader(sessionsStub() as any, state);
    assert.equal(liveOnly.earliestLocalDate(target()), "2026-08-09");
    const excluding = new SessionReflectionSourceReader(
      {
        listConversations: () => [{ id: "session-trash" }],
        listProjectConversations: () => [],
        listMessages: () => [{ conversationId: "session-trash", role: "user", id: "m1", content: "old", createdAt: "2020-01-01T00:00:00.000Z" }]
      } as any,
      state,
      undefined,
      undefined,
      undefined,
      () => true
    );
    assert.equal(excluding.earliestLocalDate(target()), undefined);
  } finally {
    state.close();
  }
});

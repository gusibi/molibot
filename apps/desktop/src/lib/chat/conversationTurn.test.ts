import assert from "node:assert/strict";
import test from "node:test";
import { runDesktopConversationTurn } from "./conversationTurn";
import { DesktopStreamInterruptedError, DesktopChatRejectedError } from "../api";

const input = { endpoint: "http://127.0.0.1:9999", profileId: "test", sessionId: "test", message: "hello", thinkingLevel: "off" as const };

test("EOF without a done event is interrupted, never completed or resubmitted", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(JSON.parse(String(init.body)).clientSurface, "desktop");
    return new Response('event: token\ndata: {"delta":"partial"}\n\n');
  });
  await assert.rejects(runDesktopConversationTurn(input), DesktopStreamInterruptedError);
  assert.equal(calls, 1);
});

test("request rejection and explicit server failure are distinct from an observer disconnect", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"error":"invalid model"}', { status: 400 }));
  await assert.rejects(runDesktopConversationTurn(input), DesktopChatRejectedError);
  t.mock.method(globalThis, "fetch", async () => new Response('event: error\ndata: {"error":"model failed"}\n\n'));
  await assert.rejects(runDesktopConversationTurn(input), cause => cause instanceof Error && !(cause instanceof DesktopStreamInterruptedError) && cause.message === "model failed");
});

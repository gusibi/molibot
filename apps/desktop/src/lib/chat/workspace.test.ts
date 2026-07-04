import assert from "node:assert/strict";
import test from "node:test";
import { shouldReuseFreshSession } from "./workspace";

test("New Chat reuses the active empty session", () => {
  assert.equal(shouldReuseFreshSession({
    activeSessionId: "session-new",
    messageCount: 0,
    sending: false,
    hasStreamingContent: false
  }), true);
});

test("New Chat creates after the active session has content", () => {
  assert.equal(shouldReuseFreshSession({
    activeSessionId: "session-used",
    messageCount: 1,
    sending: false,
    hasStreamingContent: false
  }), false);
});

test("New Chat does not race an active send", () => {
  assert.equal(shouldReuseFreshSession({
    activeSessionId: "session-new",
    messageCount: 0,
    sending: true,
    hasStreamingContent: false
  }), false);
});


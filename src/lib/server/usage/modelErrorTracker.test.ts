import assert from "node:assert/strict";
import test from "node:test";
import { ModelErrorTracker } from "./modelErrorTracker.js";

test("ModelErrorTracker records failures and returns summary", () => {
  let file = "";
  const tracker = new ModelErrorTracker({
    ensureDir: () => {},
    appendText: (text) => {
      file += text;
    },
    readText: () => file
  });

  tracker.record({
    source: "runner",
    channel: "telegram",
    botId: "bot-a",
    chatId: "chat-1",
    sessionId: "session-1",
    runId: "run-1",
    provider: "openai",
    model: "gpt-main",
    route: "text",
    kind: "request_error",
    message: "HTTP 429: rate limit",
    recovered: true,
    fallbackUsed: true,
    finalProvider: "openai",
    finalModel: "gpt-backup"
  });
  tracker.record({
    source: "assistant",
    channel: "web",
    botId: "web",
    chatId: "web",
    provider: "custom-x",
    model: "model-1",
    route: "text",
    kind: "missing_api_key",
    message: "missing credentials",
    recovered: false,
    fallbackUsed: false
  });

  const result = tracker.getRecent(10);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.recovered, 1);
  assert.equal(result.summary.unrecovered, 1);
  assert.deepEqual(result.items.map((item) => item.kind), ["missing_api_key", "request_error"]);
});

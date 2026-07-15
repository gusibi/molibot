import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptInputEnvelope } from "$lib/server/agent/prompts/promptInput.js";

test("buildPromptInputEnvelope wraps the live prompt with env metadata without polluting persisted text", () => {
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    attachmentPaths: ["/tmp/demo.txt"],
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai"
  });

  assert.equal(
    result.modelMessage,
    [
      "<env>",
      "message_received_at: 2026-04-26T10:59:24+08:00",
      "timezone: Asia/Shanghai",
      "today: 2026-04-26",
      "scratch_artifact_dir: 2026/04/26",
      "</env>",
      "",
      "<user_message>",
      "Hi",
      "</user_message>",
      "",
      "<channel_attachments>",
      "/tmp/demo.txt",
      "</channel_attachments>"
    ].join("\n")
  );
  assert.equal(
    result.persistedMessage,
    ["Hi", "", "<channel_attachments>", "/tmp/demo.txt", "</channel_attachments>"].join("\n")
  );
});

test("buildPromptInputEnvelope injects the memory snapshot into the model message only", () => {
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshotText: "Long-term memory:\n1. User prefers concise replies."
  });

  assert.ok(result.modelMessage.includes("<current-memory>"));
  assert.ok(result.modelMessage.includes("User prefers concise replies."));
  assert.ok(result.modelMessage.indexOf("<current-memory>") < result.modelMessage.indexOf("<user_message>"));
  assert.ok(!result.persistedMessage.includes("<current-memory>"));
});

test("buildPromptInputEnvelope omits the memory block when the snapshot is empty", () => {
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshotText: "   "
  });

  assert.ok(!result.modelMessage.includes("<current-memory>"));
});

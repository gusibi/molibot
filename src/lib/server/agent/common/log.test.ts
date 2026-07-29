import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMomLogPayload,
  formatMomPrettyLine,
  isMomLogEventEnabled
} from "$lib/server/agent/common/log.js";

test("formatMomPrettyLine renders readable system prompt preview logs", () => {
  const line = formatMomPrettyLine(
    "telegram",
    "system_prompt_preview_written",
    {
      botId: "moli_news_bot",
      workspaceDir: "/tmp/bot",
      filePath: "/tmp/bot/SYSTEM_PROMPT.preview.md",
      chatId: "7706709760",
      sessionId: "default",
      promptLength: 25161,
    },
    new Date("2026-04-23T15:57:25.000Z"),
  );

  assert.match(line, /\[mom-t\]/);
  assert.match(line, /2026-04-23/);
  assert.match(line, /telegram/);
  assert.match(line, /system_prompt_preview_written/);
  assert.match(line, /bot=moli_news_bot/);
  assert.match(line, /prompt=25161/);
  assert.doesNotMatch(line, /botId=moli_news_bot/);
  assert.doesNotMatch(line, /"scope":"telegram"/);
});

test("structured service log payloads carry a stable envelope and redact secrets", () => {
  const payload = buildMomLogPayload(
    "error",
    "runner",
    "llm_request_failed",
    {
      runId: "run-1",
      authorization: "Bearer top-secret",
      nested: { apiKey: "sk-secret", upstreamAuthToken: "nested-secret", safe: "visible" },
      url: "https://example.test/v1?token=secret&mode=fast",
      message: "Authorization: Bearer another-secret"
    },
    new Date("2026-07-29T12:00:00.000Z")
  );

  assert.equal(payload.ts, "2026-07-29T12:00:00.000Z");
  assert.equal(payload.level, "error");
  assert.equal(payload.category, "llm");
  assert.equal(payload.event, "llm_request_failed");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.runId, "run-1");
  assert.equal(payload.authorization, "[REDACTED]");
  assert.deepEqual(payload.nested, { apiKey: "[REDACTED]", upstreamAuthToken: "[REDACTED]", safe: "visible" });
  assert.equal(payload.url, "https://example.test/v1?token=%5BREDACTED%5D&mode=fast");
  assert.doesNotMatch(JSON.stringify(payload), /top-secret|sk-secret|nested-secret|another-secret/);
});

test("operational Subagent LLM and tool events are included without verbose logging", () => {
  assert.equal(isMomLogEventEnabled("subagent_llm_call_start"), true);
  assert.equal(isMomLogEventEnabled("subagent_llm_call_end"), true);
  assert.equal(isMomLogEventEnabled("subagent_tool_start"), true);
  assert.equal(isMomLogEventEnabled("subagent_tool_end"), true);
});

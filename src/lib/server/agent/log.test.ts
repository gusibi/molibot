import assert from "node:assert/strict";
import test from "node:test";
import { formatMomPrettyLine } from "./log.ts";

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

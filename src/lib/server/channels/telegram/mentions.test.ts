import assert from "node:assert/strict";
import test from "node:test";
import { isTelegramBotMention, stripTelegramBotMention } from "$lib/server/channels/telegram/mentions.js";

test("telegram bot mention matches direct username text", () => {
  const text = "@molipi_bot hi";

  assert.equal(isTelegramBotMention(text, [], "molipi_bot"), true);
  assert.equal(stripTelegramBotMention(text, [], "molipi_bot"), "hi");
});

test("telegram bot mention matches mention entity offsets", () => {
  const text = "hi @molipi_bot";
  const entities = [{ type: "mention", offset: 3, length: 11 }];

  assert.equal(isTelegramBotMention(text, entities, "molipi_bot"), true);
  assert.equal(stripTelegramBotMention(text, entities, "molipi_bot"), "hi");
});

test("telegram bot mention matches text_mention entities for the configured bot", () => {
  const text = "MoliPI hi";
  const entities = [{ type: "text_mention", offset: 0, length: 6, user: { is_bot: true, username: "molipi_bot" } }];

  assert.equal(isTelegramBotMention(text, entities, "molipi_bot"), true);
  assert.equal(stripTelegramBotMention(text, entities, "molipi_bot"), "hi");
});

test("telegram bot mention ignores other bot usernames", () => {
  const text = "@other_bot hi";
  const entities = [{ type: "mention", offset: 0, length: 10 }];

  assert.equal(isTelegramBotMention(text, entities, "molipi_bot"), false);
  assert.equal(stripTelegramBotMention(text, entities, "molipi_bot"), "@other_bot hi");
});

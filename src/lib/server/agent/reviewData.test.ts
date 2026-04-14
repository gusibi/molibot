import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readSkillDrafts } from "./reviewData.js";

test("readSkillDrafts reads one bot-level draft directory only once even with multiple chats", () => {
  const root = join(process.cwd(), "src/lib/server/agent/testdata/review-drafts");
  const filePath = join(
    root,
    "moli-t",
    "bots",
    "molifin_bot",
    "skill-drafts",
    "2026-04-11-event.md"
  );

  const { items, diagnostics } = readSkillDrafts(root);

  assert.deepEqual(diagnostics, []);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.filePath, filePath);
  assert.equal(items[0]?.botId, "molifin_bot");
});

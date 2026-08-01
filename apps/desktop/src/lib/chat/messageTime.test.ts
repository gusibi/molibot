import assert from "node:assert/strict";
import test from "node:test";
import { formatMessageTime } from "./messageTime";

const now = new Date(2026, 7, 1, 12, 0);

test("message time uses contextual dates without losing the clock", () => {
  assert.doesNotMatch(formatMessageTime(new Date(2026, 7, 1, 9, 30).toISOString(), "Yesterday", now), /Yesterday/);
  assert.match(formatMessageTime(new Date(2026, 6, 31, 9, 30).toISOString(), "Yesterday", now), /^Yesterday /);
  assert.match(formatMessageTime(new Date(2026, 6, 28, 9, 30).toISOString(), "Yesterday", now), /28/);
  assert.match(formatMessageTime(new Date(2025, 6, 28, 9, 30).toISOString(), "Yesterday", now), /2025/);
});

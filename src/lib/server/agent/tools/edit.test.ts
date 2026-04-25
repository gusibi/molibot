import test from "node:test";
import assert from "node:assert/strict";
import { buildDiff } from "./edit.js";

test("edit reports line-aware diff with insertion and deletion context", async () => {
  const diff = buildDiff(
    "alpha\nbeta\ngamma\ndelta\n",
    "alpha\nbeta\ninserted\ndelta\n"
  );

  assert.match(diff, / 1 alpha/);
  assert.match(diff, / 2 beta/);
  assert.match(diff, /-3 gamma/);
  assert.match(diff, /\+3 inserted/);
  assert.match(diff, / 4 delta/);
});

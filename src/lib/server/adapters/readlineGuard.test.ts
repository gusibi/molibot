import assert from "node:assert/strict";
import test from "node:test";
import { isIgnorableReadlineError } from "$lib/server/adapters/readlineGuard.js";

test("isIgnorableReadlineError only accepts TTY read EIO", () => {
  assert.equal(isIgnorableReadlineError({ code: "EIO", syscall: "read" }), true);
  assert.equal(isIgnorableReadlineError({ code: "EIO", syscall: "write" }), false);
  assert.equal(isIgnorableReadlineError({ code: "EPERM", syscall: "read" }), false);
  assert.equal(isIgnorableReadlineError(null), false);
});

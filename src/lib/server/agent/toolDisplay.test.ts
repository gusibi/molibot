import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolDisplayName } from "./toolDisplay.js";

test("resolveToolDisplayName marks sandboxed bash without changing other tools", () => {
  assert.equal(resolveToolDisplayName("read"), "read");
  assert.equal(resolveToolDisplayName("bash"), "bash");
  assert.equal(resolveToolDisplayName("bash", { sandboxAttempted: true }), "Sandbox");
  assert.equal(resolveToolDisplayName("bash", { result: { details: { sandboxApplied: true } } }), "Sandbox");
  assert.equal(
    resolveToolDisplayName("bash", { result: { details: { sandboxApplied: false, sandboxWarning: "init failed" } } }),
    "Sandbox disabled"
  );
});

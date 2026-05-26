import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlannedBashDisplayName, resolveToolDisplayName } from "./toolDisplay.js";

test("resolveToolDisplayName marks sandboxed bash without changing other tools", () => {
  assert.equal(resolveToolDisplayName("read"), "read");
  assert.equal(resolveToolDisplayName("bash"), "bash");
  assert.equal(resolveToolDisplayName("bash", { sandboxAttempted: true }), "Sandbox");
  assert.equal(resolveToolDisplayName("bash", { result: { details: { sandboxApplied: true } } }), "Sandbox");
  assert.equal(resolveToolDisplayName("bash", { result: { details: { hostBash: true } } }), "Host Bash");
  assert.equal(
    resolveToolDisplayName("bash", { result: { details: { sandboxApplied: false, sandboxWarning: "init failed" } } }),
    "Sandbox disabled"
  );
  assert.equal(
    resolveToolDisplayName("bash", { result: { details: { sandboxApplied: false, sandboxWarning: "session-approved host bash fallback" } } }),
    "Host Bash"
  );
});

test("resolvePlannedBashDisplayName prefers approved Host Bash over sandbox label", () => {
  const hostBashStore = {
    getApprovedEntry: (toolId: string) => toolId === "printf"
      ? { enabled: true }
      : null
  } as any;

  assert.equal(resolvePlannedBashDisplayName({
    command: "printf 'hello'",
    hostBashStore,
    sandboxAttempted: true
  }), "Host Bash");
  assert.equal(resolvePlannedBashDisplayName({
    command: "cat ./file.txt",
    hostBashStore,
    sandboxAttempted: true
  }), "Sandbox");
});

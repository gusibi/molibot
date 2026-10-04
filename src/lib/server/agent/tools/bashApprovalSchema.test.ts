import assert from "node:assert/strict";
import test from "node:test";
import { TypeGuard } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getBashToolDefinition } from "./bash.js";

test("plain Bash admits explicit null approval and does not request host access", async () => {
  const def = getBashToolDefinition({ cwd: "/tmp", executionTarget: "sandbox" });
  assert.ok(TypeGuard.IsSchema(def.inputSchema));
  const params = { label: "test", command: "node acceptance/wait-and-write.mjs A04-first 30", timeout: 120, hostApproval: null };
  assert.equal(Value.Check(def.inputSchema, params), true);
  assert.equal(await def.prepare!(params, {} as never), undefined);
});

test("Bash schema rejects empty host approval reasons before preparation", () => {
  const def = getBashToolDefinition({ cwd: "/tmp", executionTarget: "sandbox" });
  assert.ok(TypeGuard.IsSchema(def.inputSchema));
  const base = { label: "test", command: "node acceptance/append-once.mjs B01" };
  assert.equal(Value.Check(def.inputSchema, base), true);
  assert.equal(Value.Check(def.inputSchema, { ...base, hostApproval: {
    reason: "", displayName: "", permissions: { envAllowlist: [], filesystem: "none", network: "none" }
  } }), false);
  assert.equal(Value.Check(def.inputSchema, { ...base, hostApproval: { reason: "   " } }), false);
  assert.equal(Value.Check(def.inputSchema, { ...base, hostApproval: { reason: "Needs host IPC." } }), true);
});

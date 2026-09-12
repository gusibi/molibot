import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { permissionModeInstructionsFor } from "$lib/server/agent/prompts/modeInstructions.js";

test("each execution mode renders its own runtime instruction", () => {
  const plan = permissionModeInstructionsFor("plan");
  const manual = permissionModeInstructionsFor("manual");
  const acceptEdits = permissionModeInstructionsFor("accept_edits");
  const auto = permissionModeInstructionsFor("auto");

  for (const instructions of [plan, manual, acceptEdits, auto]) {
    assert.ok(instructions.length >= 1);
    assert.ok(instructions[0].length > 40);
  }
  assert.match(plan[0], /Plan mode/);
  assert.match(plan[0], /exitPlan/);
  assert.match(manual[0], /approval/);
  assert.match(acceptEdits[0], /Accept Edits mode/);
  assert.match(auto[0], /Full Access/);
  assert.match(auto[0], /without approval prompts/);
  assert.match(auto[0], /never sandboxed first/);

  // The four renderings are mutually distinct: a prompt that reads the same in
  // every mode would be lying to the model in three of them.
  const texts = new Set([plan[0], manual[0], acceptEdits[0], auto[0]]);
  assert.equal(texts.size, 4);
});

test("the sandbox → host-access contract applies only where the machinery exists", () => {
  const auto = permissionModeInstructionsFor("auto");
  const allAuto = auto.join("\n");
  assert.doesNotMatch(allAuto, /hostApproval/, "full access must not teach approval requests");
  assert.doesNotMatch(allAuto, /sandboxed commands/, "full access has no sandbox");

  for (const mode of ["manual", "accept_edits"] as const) {
    const contract = permissionModeInstructionsFor(mode).join("\n");
    assert.match(contract, /runtime-managed sandbox/);
    assert.match(contract, /hostApproval=/, "restricted modes carry the host-access request syntax");
  }

  // Plan has no shell at all: no approval syntax to teach.
  assert.doesNotMatch(permissionModeInstructionsFor("plan").join("\n"), /hostApproval=/);
});

test("the static system prompt no longer teaches sandbox approval requirements", () => {
  // Regression (unified execution modes review): the cache-stable prompt used
  // to declare "Bash runs in a runtime-managed sandbox … request approval",
  // contradicting Full Access. The contract moved into per-attempt runtime
  // instructions, so the static prompt must be mode-neutral.
  const promptSource = readFileSync(new URL("./prompt.ts", import.meta.url), "utf8");
  assert.equal(promptSource.includes("host-tool-approval"), false);
  assert.equal(promptSource.includes("Bash runs in a runtime-managed sandbox"), false);
  assert.equal(promptSource.includes("buildHostToolApprovalSection"), false);
});

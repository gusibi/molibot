import assert from "node:assert/strict";
import test from "node:test";
import { permissionModeInstructionsFor } from "$lib/server/agent/prompts/modeInstructions.js";

test("each execution mode renders its own runtime instruction", () => {
  const plan = permissionModeInstructionsFor("plan");
  const manual = permissionModeInstructionsFor("manual");
  const acceptEdits = permissionModeInstructionsFor("accept_edits");
  const auto = permissionModeInstructionsFor("auto");

  for (const instructions of [plan, manual, acceptEdits, auto]) {
    assert.equal(instructions.length, 1);
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

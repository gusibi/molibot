import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createExitPlanTool } from "./exitPlan";

test("exitPlan persists one structured proposal and terminates Plan mode", async () => {
  const scratchDir = mkdtempSync(join(tmpdir(), "molibot-plan-"));
  const emitted: unknown[] = [];
  try {
    const result = await createExitPlanTool({ scratchDir, sessionId: "s-1", emit: (plan) => emitted.push(plan) })
      .execute("call-1", { title: "Ship chat", summary: "Finish the transcript", steps: ["Model steps", "Render plan"] }, undefined, undefined);
    const plan = emitted[0] as { artifactPath: string; steps: Array<{ text: string }>; status: string };
    assert.equal(result.terminate, true);
    assert.equal(plan.status, "proposed");
    assert.deepEqual(plan.steps.map((step) => step.text), ["Model steps", "Render plan"]);
    assert.equal(existsSync(join(scratchDir, plan.artifactPath)), true);
    assert.match(readFileSync(join(scratchDir, plan.artifactPath), "utf8"), /1\. \[ \] Model steps/);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

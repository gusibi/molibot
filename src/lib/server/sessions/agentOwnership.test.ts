import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findAgentOwnershipDivergences, reportAgentOwnershipDivergences } from "./agentOwnership.js";

function root(t: test.TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "molibot-ownership-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seed(dataRoot: string, workspace: string, sessionId: string, meta: unknown): void {
  const contexts = join(dataRoot, "sessions", workspace, "contexts");
  mkdirSync(contexts, { recursive: true });
  writeFileSync(join(contexts, `${sessionId}.meta.json`), JSON.stringify(meta));
}

test("ownership reconcile reports a stored/mirrored conflict without rewriting it", (t) => {
  const dataRoot = root(t);
  seed(dataRoot, "researcher", "agrees", { agentId: "researcher", ui: { conversation: { id: "agrees", agentId: "researcher" } } });
  seed(dataRoot, "researcher", "conflict", { agentId: "researcher", ui: { conversation: { id: "conflict", agentId: "writer" } } });
  seed(dataRoot, "writer", "mirror-only", { ui: { conversation: { id: "mirror-only", agentId: "writer" } } });
  seed(dataRoot, "writer", "stored-only", { agentId: "writer" });

  assert.deepEqual(findAgentOwnershipDivergences(dataRoot), [
    { sessionId: "conflict", workspace: "researcher", storedAgentId: "researcher", mirroredAgentId: "writer" }
  ]);
  const report = reportAgentOwnershipDivergences(dataRoot);
  assert.equal(report.checked, 4);
  assert.equal(report.diverged, 1);
  assert.equal(report.items[0]?.sessionId, "conflict");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Approval handlers must resume the original execution with its admitted working directory. */
const CALL_SITES = [
  "src/routes/api/chat/+server.ts",
  "src/lib/server/channels/shared/baseRuntime.ts"
];

const repoRoot = new URL("../../../../", import.meta.url).pathname;

for (const relativePath of CALL_SITES) {
  test(`${relativePath} wakes the original owner without executing Host Bash out of band`, () => {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /executeHostBashApproval|claimExecution|markExecution/);
    assert.match(source, /resumeSuspendedBrokerApproval/);
  });
}

test("the shared working-dir helper still prefers the project root over the scratch dir", async () => {
  const { resolveSessionWorkingDir } = await import("$lib/server/agent/core/runner.js");
  assert.equal(
    resolveSessionWorkingDir(
      { id: "p1", name: "p", rootPath: "/repo", scratchDir: "/scratch" },
      "/scratch"
    ),
    "/repo"
  );
  assert.equal(resolveSessionWorkingDir(undefined, "/scratch"), "/scratch");
});

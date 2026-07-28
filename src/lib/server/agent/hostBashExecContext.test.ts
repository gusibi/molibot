import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Machine guard for the root-cause class behind "I clicked approve and nothing
 * happened": the same approved command is executed from two places — inside the
 * run (`bash.ts`, which has the agent's real `ctx.cwd`) and out-of-band from an
 * approval handler — and the out-of-band callers each resolved their own cwd.
 * They picked the chat scratch dir, so a project session's `git push` ran
 * outside the repository and died with "not a git repository".
 *
 * Any cwd for `executeHostBashApproval` must therefore come from the shared
 * `resolveSessionWorkingDir(project, scratch)` the runner itself uses, never
 * from a bare scratch-dir lookup. This is a source-level check on purpose: the
 * failure is a *missing* branch, so it cannot be caught by exercising the
 * handlers that already have the bug.
 */
const CALL_SITES = [
  "src/routes/api/chat/+server.ts",
  "src/lib/server/channels/shared/baseRuntime.ts"
];

const repoRoot = new URL("../../../../", import.meta.url).pathname;

for (const relativePath of CALL_SITES) {
  test(`${relativePath} resolves approval cwd through the shared working-dir helper`, () => {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    const calls = [...source.matchAll(/executeHostBashApproval\(\{[\s\S]*?\n\s*\}\)/g)].map((match) => match[0]);
    assert.ok(calls.length > 0, `expected at least one executeHostBashApproval call in ${relativePath}`);

    for (const call of calls) {
      // Either `cwd: <expr>` or the `cwd` shorthand for a local binding.
      const explicit = /cwd:\s*([^\n,]+)/.exec(call)?.[1]?.trim();
      const shorthand = /^\s*cwd\s*,?\s*$/m.test(call);
      assert.ok(explicit || shorthand, `executeHostBashApproval in ${relativePath} must pass an explicit cwd`);

      // Where the value ultimately comes from: the inline expression, or the
      // local `const cwd = …` the shorthand refers to.
      const source_ = explicit ?? /const\s+cwd\s*=\s*([^;]+);/.exec(source)?.[1] ?? "";
      assert.doesNotMatch(
        source_,
        /getScratchDir\(/,
        `executeHostBashApproval in ${relativePath} must not run in the scratch dir directly — `
          + "a project conversation runs in the project root. Use resolveSessionWorkingDir(project, scratch)."
      );
      assert.match(
        source_,
        /resolveSessionWorkingDir/,
        `executeHostBashApproval in ${relativePath} must derive cwd from resolveSessionWorkingDir`
      );
    }
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

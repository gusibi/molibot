import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDiff, createEditTool } from "$lib/server/agent/tools/edit.js";

test("edit reports line-aware diff with insertion and deletion context", async () => {
  const diff = buildDiff(
    "alpha\nbeta\ngamma\ndelta\n",
    "alpha\nbeta\ninserted\ndelta\n"
  );

  assert.match(diff, / 1 alpha/);
  assert.match(diff, / 2 beta/);
  assert.match(diff, /-3 gamma/);
  assert.match(diff, /\+3 inserted/);
  assert.match(diff, / 4 delta/);
});

function withTempDir(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-edit-"));
  return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

test("edit inserts dollar-sign replacement patterns literally", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.sh"), "echo placeholder\n");
    await createEditTool({ cwd, workspaceDir: cwd }).execute("t1", {
      label: "edit",
      path: "a.sh",
      oldText: "placeholder",
      newText: "$& $' $` $$"
    });
    assert.equal(readFileSync(join(cwd, "a.sh"), "utf8"), "echo $& $' $` $$\n");
  });
});

test("edit replaceAll replaces every occurrence and reports count", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "foo bar foo baz foo\n");
    const result = await createEditTool({ cwd, workspaceDir: cwd }).execute("t1", {
      label: "edit",
      path: "a.txt",
      oldText: "foo",
      newText: "qux",
      replaceAll: true
    });
    assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "qux bar qux baz qux\n");
    assert.match((result.content[0] as any)?.text ?? "", /replaced 3 occurrences/);
  });
});

test("project edit returns a project-relative structured file result", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "README.md"), "before\n");
    const result = await createEditTool({
      cwd,
      workspaceDir: cwd,
      outputLayout: { projectRoot: cwd, scratchRoot: join(cwd, ".scratch") }
    }).execute("t1", {
      label: "edit",
      path: "README.md",
      oldText: "before",
      newText: "after"
    });
    assert.equal((result.details as any)?.relativePath, "README.md");
    assert.equal((result.details as any)?.rootKind, "project");
    assert.equal((result.details as any)?.action, "modified");
  });
});

test("edit rejects ambiguous matches with count when replaceAll is false", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "x\nx\n");
    await assert.rejects(
      createEditTool({ cwd, workspaceDir: cwd }).execute("t1", {
        label: "edit",
        path: "a.txt",
        oldText: "x",
        newText: "y"
      }),
      /Found 2 matches/
    );
  });
});

test("edit rejects identical oldText and newText", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "same\n");
    await assert.rejects(
      createEditTool({ cwd, workspaceDir: cwd }).execute("t1", {
        label: "edit",
        path: "a.txt",
        oldText: "same",
        newText: "same"
      }),
      /exactly the same/
    );
  });
});

test("edit matches and preserves CRLF line endings", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "one\r\ntwo\r\nthree\r\n");
    await createEditTool({ cwd, workspaceDir: cwd }).execute("t1", {
      label: "edit",
      path: "a.txt",
      oldText: "two\nthree",
      newText: "TWO\nTHREE"
    });
    assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "one\r\nTWO\r\nTHREE\r\n");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDiff, createEditTool } from "$lib/server/agent/tools/edit.js";
import { createWriteTool } from "$lib/server/agent/tools/write.js";

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

test("concurrent edits to the same file do not drop each other", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
    const edit = createEditTool({ cwd, workspaceDir: cwd });

    // Without a per-file lock both calls read the pre-edit content and the
    // second write silently discards the first edit.
    await Promise.all([
      edit.execute("t1", { label: "edit", path: "a.txt", oldText: "one", newText: "ONE" }),
      edit.execute("t2", { label: "edit", path: "a.txt", oldText: "two", newText: "TWO" })
    ]);

    assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "ONE\nTWO\n");
  });
});

test("a concurrent write cannot land inside an edit's read-modify-write", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
    const edit = createEditTool({ cwd, workspaceDir: cwd });
    const write = createWriteTool({ cwd, workspaceDir: cwd, chatId: "chat-1" });

    await Promise.all([
      edit.execute("t1", { label: "edit", path: "a.txt", oldText: "one", newText: "ONE" }),
      write.execute("t2", { label: "write", path: "a.txt", content: "replaced\n" })
    ]);

    // Whichever ran second fully owns the file; the interleaved
    // "edit read old content, write landed, edit wrote stale content" outcome
    // (which reintroduces the pre-write text) must not happen.
    const result = readFileSync(join(cwd, "a.txt"), "utf8");
    assert.ok(
      result === "replaced\n" || result === "ONE\ntwo\n",
      `unexpected interleaved result: ${JSON.stringify(result)}`
    );
  });
});

test("edits to different files still run concurrently", async () => {
  await withTempDir(async (cwd) => {
    writeFileSync(join(cwd, "a.txt"), "one\n");
    writeFileSync(join(cwd, "b.txt"), "one\n");
    const edit = createEditTool({ cwd, workspaceDir: cwd });

    await Promise.all([
      edit.execute("t1", { label: "edit", path: "a.txt", oldText: "one", newText: "A" }),
      edit.execute("t2", { label: "edit", path: "b.txt", oldText: "one", newText: "B" })
    ]);

    assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "A\n");
    assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "B\n");
  });
});

test("diff elides unchanged lines between distant edits", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
  const after = before.split("\n").map((line, i) => (i === 2 ? "FIRST" : i === 25 ? "SECOND" : line)).join("\n");

  const diff = buildDiff(before, after);
  assert.match(diff, /-\s*3 line2/);
  assert.match(diff, /\+\s*3 FIRST/);
  assert.match(diff, /-26 line25/);
  assert.match(diff, /\+26 SECOND/);
  assert.match(diff, /\.\.\./, "the untouched middle must be collapsed");
  assert.doesNotMatch(diff, /line15/, "far-away context must not be emitted");
});

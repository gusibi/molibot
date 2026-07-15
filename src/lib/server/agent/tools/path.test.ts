import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPathGuard, resolveToolPath } from "./path.js";

test("project cwd resolves ordinary and memory-looking relative paths inside the project", () => {
  const cwd = path.join(os.tmpdir(), "project-root");
  assert.equal(resolveToolPath(cwd, "docs/a.md"), path.resolve(cwd, "docs/a.md"));
  assert.equal(resolveToolPath(cwd, "memory/notes.md"), path.resolve(cwd, "memory/notes.md"));
});

test("path guard allows project and Workspace trees but rejects unrelated paths", () => {
  const root = path.join(os.tmpdir(), "molibot-path-guard");
  const cwd = path.join(root, "project");
  const workspace = path.join(root, "data", "moli-w");
  const guard = createPathGuard(cwd, workspace);
  assert.doesNotThrow(() => guard(path.join(cwd, "src", "file.ts")));
  assert.doesNotThrow(() => guard(path.join(workspace, "attachments", "file.txt")));
  assert.throws(() => guard(path.join(root, "outside", "secret.txt")), /outside allowed workspace roots/);
});

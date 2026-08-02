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

// A home prefix must mean the same thing in `read`/`ls`/`write` as it does in
// `bash`; resolving it against the chat scratch dir produced `<scratch>/~/...`
// and a "Path not found" that pointed nowhere useful.
test("resolveToolPath expands shell-style home prefixes instead of nesting them under cwd", () => {
  const cwd = path.join(os.tmpdir(), "chat", "scratch");
  const home = os.homedir();
  assert.equal(resolveToolPath(cwd, "~/.molibot/miniapps/apps/x"), path.resolve(home, ".molibot/miniapps/apps/x"));
  assert.equal(resolveToolPath(cwd, "$HOME/.molibot/skills"), path.resolve(home, ".molibot/skills"));
  assert.equal(resolveToolPath(cwd, "~"), path.resolve(home));
  // A literal `~` inside the path is a directory name, not a home prefix.
  assert.equal(resolveToolPath(cwd, "docs/~notes.md"), path.resolve(cwd, "docs/~notes.md"));
});

// `miniapp-creator` scaffolds into `<dataRoot>/miniapps/apps/<id>` and then
// tells the agent to edit `server/index.mjs`; without this root the whole
// authoring workflow can only read through `bash cat` and can never write.
test("path guard allows the Mini App code root but not its private data root", () => {
  const root = path.join(os.tmpdir(), "molibot-miniapp-guard");
  const workspace = path.join(root, "moli-w", "bots", "Web-miniapp");
  const cwd = path.join(workspace, "chat", "scratch");
  const guard = createPathGuard(cwd, workspace);
  assert.doesNotThrow(() => guard(path.join(root, "miniapps", "apps", "expense-tracker", "server", "index.mjs")));
  assert.throws(
    () => guard(path.join(root, "miniapps", "data", "expense-tracker", "app.sqlite")),
    /outside allowed workspace roots/
  );
});

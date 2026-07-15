import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectGitDiff, getProjectGitStatus, listProjectTree, readProjectFile } from "./inspection.js";
import type { ProjectRecord } from "./store.js";

function fixture(rootPath: string): ProjectRecord {
  return { id: "test", name: "Test", rootPath, createdAt: "", updatedAt: "" };
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

test("tree is bounded, hides .git, and does not follow outside symlinks", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-"));
  const outside = mkdtempSync(join(tmpdir(), "molibot-outside-"));
  try {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    writeFileSync(join(root, "c.txt"), "c");
    symlinkSync(outside, join(root, "0-outside"));
    const page = await listProjectTree(fixture(root), { limit: 3 });
    assert.equal(page.entries.some((entry) => entry.name === ".git"), false);
    assert.equal(page.entries.some((entry) => entry.kind === "symlink"), true);
    assert.equal(page.truncated, true);
    assert.ok(page.nextCursor);
    const nextPage = await listProjectTree(fixture(root), { limit: 3, cursor: page.nextCursor });
    assert.equal(nextPage.entries.some((entry) => page.entries.some((previous) => previous.path === entry.path)), false);
    assert.equal([...page.entries, ...nextPage.entries].length, 4);
    await assert.rejects(() => readProjectFile(fixture(root), { path: "0-outside/secret.txt" }), /outside|Symbolic/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("file preview and diff report binary and oversized states without rendering bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-binary-"));
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(root, "large.txt"), "x".repeat(300 * 1024));
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 4, 5, 6]));
    writeFileSync(join(root, "large.txt"), "y".repeat(300 * 1024));
    assert.equal((await getProjectGitDiff(fixture(root), { path: "binary.bin" })).status, "binary");
    assert.equal((await getProjectGitDiff(fixture(root), { path: "large.txt" })).status, "oversized");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("large deleted-file diffs are returned with an explicit truncation flag", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-truncated-"));
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "huge.txt"), Array.from({ length: 120_000 }, (_, index) => `line-${index}-xxxxxxxx`).join("\n"));
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    rmSync(join(root, "huge.txt"));
    const diff = await getProjectGitDiff(fixture(root), { path: "huge.txt" });
    assert.equal(diff.status, "diff");
    if (diff.status === "diff") assert.equal(diff.truncated, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a project inside a larger repository exposes only project-relative paths", async () => {
  const repo = mkdtempSync(join(tmpdir(), "molibot-inspection-parent-"));
  const root = join(repo, "packages", "app");
  try {
    mkdirSync(root, { recursive: true });
    git(repo, "init");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "outside.txt"), "outside\n");
    writeFileSync(join(root, "inside.txt"), "inside\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "initial");
    writeFileSync(join(repo, "outside.txt"), "changed outside\n");
    writeFileSync(join(root, "inside.txt"), "changed inside\n");
    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status === "ok") assert.deepEqual(status.entries.map((entry) => entry.path), ["inside.txt"]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("an empty repository treats new text files as untracked previews", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-empty-"));
  try {
    git(root, "init");
    writeFileSync(join(root, "first.txt"), "first\n");
    const diff = await getProjectGitDiff(fixture(root), { path: "first.txt" });
    assert.equal(diff.status, "untracked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("git status and diff cover staged, unstaged, untracked, spaces, and deleted files", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-git-"));
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "tracked file.txt"), "before\n");
    writeFileSync(join(root, "deleted.txt"), "delete me\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    writeFileSync(join(root, "tracked file.txt"), "after\n");
    rmSync(join(root, "deleted.txt"));
    writeFileSync(join(root, "new file.txt"), "new\n");

    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status !== "ok") return;
    assert.ok(status.entries.some((entry) => entry.path === "tracked file.txt"));
    assert.ok(status.entries.some((entry) => entry.path === "deleted.txt"));
    assert.ok(status.entries.some((entry) => entry.path === "new file.txt" && entry.untracked));
    const tracked = await getProjectGitDiff(fixture(root), { path: "tracked file.txt" });
    assert.equal(tracked.status, "diff");
    const deleted = await getProjectGitDiff(fixture(root), { path: "deleted.txt" });
    assert.equal(deleted.status, "diff");
    const untracked = await getProjectGitDiff(fixture(root), { path: "new file.txt" });
    assert.equal(untracked.status, "untracked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-git directories return unavailable instead of throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-nogit-"));
  try {
    const result = await getProjectGitStatus(fixture(root));
    assert.equal(result.status, "unavailable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("git inspection overrides repository fsmonitor commands", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-fsmonitor-"));
  const marker = join(root, "fsmonitor-ran");
  const hook = join(root, "fsmonitor.sh");
  try {
    git(root, "init");
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git(root, "config", "core.fsmonitor", hook);
    const result = await getProjectGitStatus(fixture(root));
    assert.equal(result.status, "ok");
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

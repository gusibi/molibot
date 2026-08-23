import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countBufferLines, getProjectGitDiff, getProjectGitStatus, listProjectTree, MAX_UNTRACKED_STAT_BYTES, readProjectFile } from "./inspection.js";
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

test("file preview and diff report binary states without rendering bytes", async () => {
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
    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status === "ok") {
      const binary = status.entries.find((entry) => entry.path === "binary.bin");
      assert.deepEqual(
        binary && { additions: binary.additions, deletions: binary.deletions, binary: binary.binary },
        { additions: null, deletions: null, binary: true }
      );
    }
    assert.equal((await getProjectGitDiff(fixture(root), { path: "binary.bin" })).status, "binary");
    // A file past the old 256 KB preview cap is now diffable like any other.
    assert.equal((await getProjectGitDiff(fixture(root), { path: "large.txt" })).status, "diff");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("text preview pages through a file larger than one window", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-paged-"));
  try {
    const content = "line\n".repeat(200_000); // 1 MB, past PREVIEW_WINDOW_BYTES.
    writeFileSync(join(root, "big.txt"), content);

    const first = await readProjectFile(fixture(root), { path: "big.txt" });
    assert.equal(first.status, "text");
    if (first.status !== "text") return;
    assert.equal(first.byteOffset, 0);
    assert.equal(first.truncated, true);
    assert.equal(first.sizeBytes, Buffer.byteLength(content));

    let assembled = first.content;
    let offset = first.byteOffset + first.byteLength;
    let guard = 0;
    for (;;) {
      const page = await readProjectFile(fixture(root), { path: "big.txt", offset });
      assert.equal(page.status, "text");
      if (page.status !== "text") return;
      assembled += page.content;
      offset = page.byteOffset + page.byteLength;
      if (!page.truncated) break;
      assert.ok((guard += 1) < 64, "paging did not terminate");
    }
    assert.equal(assembled, content);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("paged windows never split a multi-byte character", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-cjk-"));
  try {
    // 700 KB of CJK guarantees a window boundary lands inside a 3-byte sequence.
    const content = "中文内容测试".repeat(40_000);
    writeFileSync(join(root, "cjk.txt"), content);

    let assembled = "";
    let offset = 0;
    for (let page = 0; page < 64; page += 1) {
      const window = await readProjectFile(fixture(root), { path: "cjk.txt", offset });
      assert.equal(window.status, "text");
      if (window.status !== "text") return;
      assert.equal(window.content.includes("�"), false, "window boundary produced a replacement character");
      assembled += window.content;
      offset = window.byteOffset + window.byteLength;
      if (!window.truncated) break;
    }
    assert.equal(assembled, content);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("UTF-16 text is decoded instead of being reported as binary", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-utf16-"));
  try {
    const text = "const greeting = \"你好\";\n".repeat(50);
    writeFileSync(join(root, "utf16.ts"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    const preview = await readProjectFile(fixture(root), { path: "utf16.ts" });
    assert.equal(preview.status, "text");
    if (preview.status !== "text") return;
    assert.equal(preview.content, text);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("files past the text preview ceiling are reported as oversized", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-oversized-"));
  try {
    const handle = openSync(join(root, "huge.log"), "w");
    ftruncateSync(handle, 17 * 1024 * 1024);
    closeSync(handle);
    const preview = await readProjectFile(fixture(root), { path: "huge.log" });
    assert.equal(preview.status, "oversized");
    assert.equal(preview.sizeBytes, 17 * 1024 * 1024);
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

test("a CJK path survives the diff headers instead of arriving backslash-octal", async () => {
  // `core.quotePath` defaults to true and this runner drops HOME / system config
  // for hermetic inspection, so a user's global `quotepath=false` never applies.
  // Without an explicit override every non-ASCII path reached the viewer as
  // "02-\345\206\205..." in the `diff --git` and `---`/`+++` headers.
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-cjk-"));
  const name = "02-内容创作/图文长文.md";
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    mkdirSync(join(root, "02-内容创作"), { recursive: true });
    writeFileSync(join(root, name), "第一行\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    writeFileSync(join(root, name), "第一行\n第二行\n");

    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status === "ok") assert.deepEqual(status.entries.map((entry) => entry.path), [name]);

    const diff = await getProjectGitDiff(fixture(root), { path: name });
    assert.equal(diff.status, "diff");
    if (diff.status === "diff") {
      assert.ok(diff.content.includes(`a/${name}`), "diff header keeps the literal UTF-8 path");
      assert.doesNotMatch(diff.content, /\\3\d\d/, "no backslash-octal escapes anywhere in the diff");
    }
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
    const trackedStatus = status.entries.find((entry) => entry.path === "tracked file.txt");
    assert.deepEqual(
      trackedStatus && { additions: trackedStatus.additions, deletions: trackedStatus.deletions, binary: trackedStatus.binary },
      { additions: 1, deletions: 1, binary: false }
    );
    const deletedStatus = status.entries.find((entry) => entry.path === "deleted.txt");
    assert.deepEqual(
      deletedStatus && { additions: deletedStatus.additions, deletions: deletedStatus.deletions, binary: deletedStatus.binary },
      { additions: 0, deletions: 1, binary: false }
    );
    const untrackedStatus = status.entries.find((entry) => entry.path === "new file.txt");
    assert.deepEqual(
      untrackedStatus && { additions: untrackedStatus.additions, deletions: untrackedStatus.deletions, binary: untrackedStatus.binary },
      { additions: 1, deletions: 0, binary: false }
    );
    assert.ok(untrackedStatus?.untracked);
    const tracked = await getProjectGitDiff(fixture(root), { path: "tracked file.txt" });
    assert.equal(tracked.status, "diff");
    const deleted = await getProjectGitDiff(fixture(root), { path: "deleted.txt" });
    assert.equal(deleted.status, "diff");
    const untracked = await getProjectGitDiff(fixture(root), { path: "new file.txt" });
    assert.equal(untracked.status, "untracked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Git numstat attaches a staged rename's stats to the new project-relative path", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-rename-stats-"));
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "old name.txt"), "one\ntwo\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    git(root, "mv", "old name.txt", "new name.txt");
    git(root, "add", "-A");

    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status !== "ok") return;
    const renamed = status.entries.find((entry) => entry.path === "new name.txt");
    assert.deepEqual(
      renamed && { additions: renamed.additions, deletions: renamed.deletions, binary: renamed.binary },
      { additions: 0, deletions: 0, binary: false }
    );
    assert.equal(renamed?.indexStatus, "R");
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

test("countBufferLines accurately counts UTF-8 and UTF-16 lines without string allocations", () => {
  assert.equal(countBufferLines(Buffer.alloc(0), "utf8"), 0);
  assert.equal(countBufferLines(Buffer.from(""), "utf8"), 0);
  assert.equal(countBufferLines(Buffer.from("hello"), "utf8"), 1);
  assert.equal(countBufferLines(Buffer.from("hello\n"), "utf8"), 1);
  assert.equal(countBufferLines(Buffer.from("hello\nworld"), "utf8"), 2);
  assert.equal(countBufferLines(Buffer.from("hello\r\nworld\r\n"), "utf8"), 2);
  assert.equal(countBufferLines(Buffer.from("one\ntwo\nthree\n"), "utf8"), 3);

  const utf16le = Buffer.from("one\ntwo\nthree\n", "utf16le");
  assert.equal(countBufferLines(utf16le, "utf16le"), 3);
  const utf16leNoTrailing = Buffer.from("one\ntwo\nthree", "utf16le");
  assert.equal(countBufferLines(utf16leNoTrailing, "utf16le"), 3);

  assert.equal(countBufferLines(Buffer.from([0x00, 0x01, 0x02]), "binary"), 0);
});

test("untracked files larger than MAX_UNTRACKED_STAT_BYTES skip line counting", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-inspection-large-untracked-"));
  try {
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "initial.txt"), "hello\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "init");

    // Create small untracked file
    writeFileSync(join(root, "small-untracked.txt"), "line1\nline2\n");
    // Create large untracked file (> 256KB)
    const largeContent = "a".repeat(1000) + "\n";
    const chunkCount = Math.ceil((MAX_UNTRACKED_STAT_BYTES + 4096) / 1001);
    writeFileSync(join(root, "large-untracked.txt"), largeContent.repeat(chunkCount));

    const status = await getProjectGitStatus(fixture(root));
    assert.equal(status.status, "ok");
    if (status.status !== "ok") return;

    const small = status.entries.find((e) => e.path === "small-untracked.txt");
    assert.ok(small?.untracked);
    assert.equal(small?.additions, 2);
    assert.equal(small?.deletions, 0);

    const large = status.entries.find((e) => e.path === "large-untracked.txt");
    assert.ok(large?.untracked);
    assert.equal(large?.additions, null);
    assert.equal(large?.deletions, null);
    assert.equal(large?.binary, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


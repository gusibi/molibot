import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fuzzyScore, searchProject } from "./search.js";
import type { ProjectRecord } from "./store.js";

function fixture(rootPath: string): ProjectRecord {
  return { id: "test", name: "Test", rootPath, createdAt: "", updatedAt: "" };
}

function sandbox(label: string): string {
  return mkdtempSync(join(tmpdir(), `molibot-search-${label}-`));
}

test("name search ranks basename and boundary matches above incidental ones", async () => {
  const root = sandbox("name");
  try {
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "src", "lib", "user-store.ts"), "x");
    writeFileSync(join(root, "src", "unrelated-scores-tally.ts"), "x");
    const result = await searchProject(fixture(root), { query: "userstore" });
    assert.equal(result.mode, "name");
    assert.equal(result.hits[0].path, "src/lib/user-store.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("name search matches CJK path segments", async () => {
  const root = sandbox("cjk");
  try {
    mkdirSync(join(root, "02-内容创作"), { recursive: true });
    writeFileSync(join(root, "02-内容创作", "选题.md"), "x");
    writeFileSync(join(root, "readme.md"), "x");
    const result = await searchProject(fixture(root), { query: "选题" });
    assert.deepEqual(result.hits.map((hit) => hit.path), ["02-内容创作/选题.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search respects root and nested .gitignore and skips vendor directories", async () => {
  const root = sandbox("ignore");
  try {
    writeFileSync(join(root, ".gitignore"), "dist/\n");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "target.ts"), "needle");
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "target.ts"), "needle");
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(join(root, "app", ".gitignore"), "generated.ts\n");
    writeFileSync(join(root, "app", "generated.ts"), "needle");
    writeFileSync(join(root, "app", "target.ts"), "needle");

    const byName = await searchProject(fixture(root), { query: "target.ts" });
    assert.deepEqual(byName.hits.map((hit) => hit.path), ["app/target.ts"]);

    const byContent = await searchProject(fixture(root), { query: "needle", mode: "content" });
    assert.deepEqual(byContent.hits.map((hit) => hit.path), ["app/target.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("content search reports line numbers and match offsets, and skips binary files", async () => {
  const root = sandbox("content");
  try {
    writeFileSync(join(root, "a.txt"), "first\nthe NEEDLE here\nlast\n");
    writeFileSync(join(root, "blob.bin"), Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]));

    const result = await searchProject(fixture(root), { query: "needle", mode: "content" });
    assert.equal(result.mode, "content");
    assert.deepEqual(result.hits.map((hit) => hit.path), ["a.txt"]);
    assert.deepEqual(result.hits[0].lines, [{ line: 2, text: "the NEEDLE here", start: 4, end: 10 }]);

    const sensitive = await searchProject(fixture(root), { query: "needle", mode: "content", caseSensitive: true });
    assert.deepEqual(sensitive.hits, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search does not follow symlinks out of the project root", async () => {
  const root = sandbox("symlink");
  const outside = mkdtempSync(join(tmpdir(), "molibot-search-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "needle");
    symlinkSync(outside, join(root, "escape"));
    const result = await searchProject(fixture(root), { query: "needle", mode: "content" });
    assert.deepEqual(result.hits, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("empty query returns no hits without walking", async () => {
  const root = sandbox("empty");
  try {
    writeFileSync(join(root, "a.txt"), "a");
    const result = await searchProject(fixture(root), { query: "   " });
    assert.deepEqual(result.hits, []);
    assert.equal(result.scanned, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fuzzyScore rejects non-subsequences", () => {
  assert.equal(fuzzyScore("src/app.ts", "zzz"), null);
  assert.ok((fuzzyScore("src/app.ts", "app") ?? 0) > 0);
});

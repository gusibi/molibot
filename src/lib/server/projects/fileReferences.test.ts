import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatProjectFileReference } from "$lib/shared/projectFileReference.js";
import { resolveProjectFileReferences } from "./fileReferences";
import type { ProjectRecord } from "./store";

function fixture(rootPath: string): ProjectRecord {
  return { id: "test", name: "Test", rootPath, createdAt: "", updatedAt: "" };
}

test("resolves selected file references into model-only canonical paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-file-ref-"));
  try {
    const relative = "02-内容创作/文章 (终稿).md";
    fs.mkdirSync(path.join(root, "02-内容创作"), { recursive: true });
    fs.writeFileSync(path.join(root, relative), "hello");
    const persistedText = `检查 ${formatProjectFileReference(relative, 12)}`;

    const result = await resolveProjectFileReferences(persistedText, fixture(root));

    assert.equal(result.persistedText, persistedText);
    assert.equal(result.modelText, "检查 [Project file #1: 文章 (终稿).md:12]");
    assert.equal(result.references.length, 1);
    assert.deepEqual(result.references[0], {
      displayName: "文章 (终稿).md:12",
      path: relative,
      line: 12
    });
    assert.match(result.runtimeInstruction, /path: "02-内容创作\/文章 \(终稿\)\.md"/);
    assert.match(result.runtimeInstruction, /Use the exact `path` value without the leading `@`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved references are withheld from the model instead of becoming guessed paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-file-ref-missing-"));
  try {
    const token = formatProjectFileReference("missing.md");
    const result = await resolveProjectFileReferences(`读取 ${token}`, fixture(root));

    assert.equal(result.modelText, "读取 [Unresolved Project file reference: missing.md]");
    assert.equal(result.references.length, 0);
    assert.match(result.runtimeInstruction, /missing\.md/);
    assert.match(result.runtimeInstruction, /Do not guess, create, or modify a replacement path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy bare at-paths from existing Sessions resolve without passing @ to tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-file-ref-legacy-"));
  try {
    const relative = "02-内容创作/02-图文长文";
    fs.mkdirSync(path.join(root, relative), { recursive: true });
    const persistedText = `写入 @${relative}，同时调用 @todo`;

    const result = await resolveProjectFileReferences(persistedText, fixture(root));

    assert.equal(result.persistedText, persistedText);
    assert.equal(result.modelText, "写入 [Project file #1: 02-图文长文]，同时调用 @todo");
    assert.deepEqual(result.references, [{ displayName: "02-图文长文", path: relative }]);
    assert.match(result.runtimeInstruction, /path: "02-内容创作\/02-图文长文"/);
    assert.doesNotMatch(result.runtimeInstruction, /path: "@/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { ProjectStore, validateProjectRootPath } from "./store.js";

test("ProjectStore creates stable slugs, rejects duplicate roots, updates, and removes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-project-store-"));
  const firstRoot = path.join(root, "first");
  const secondRoot = path.join(root, "second");
  fs.mkdirSync(firstRoot);
  fs.mkdirSync(secondRoot);
  const store = new ProjectStore(path.join(root, "settings.sqlite"));
  try {
    const first = store.create({ name: "My Wiki", rootPath: firstRoot });
    const second = store.create({ name: "My Wiki", rootPath: secondRoot, instructions: "Use pnpm." });
    assert.equal(first.id, "my-wiki");
    assert.equal(second.id, "my-wiki-2");
    assert.equal(store.get(first.id)?.rootPath, fs.realpathSync(firstRoot));
    assert.deepEqual(store.list().map((item) => item.id).sort(), ["my-wiki", "my-wiki-2"]);
    assert.throws(() => store.create({ name: "Duplicate", rootPath: firstRoot }), /already registered/);

    assert.throws(() => store.update(first.id, { name: "Renamed", rootPath: secondRoot }), /already registered/);
    const updated = store.update(first.id, { name: "Renamed", instructions: "Keep it small." });
    assert.equal(updated?.id, "my-wiki");
    assert.equal(updated?.name, "Renamed");
    assert.equal(store.remove(first.id), true);
    assert.equal(store.get(first.id), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validateProjectRootPath rejects unsafe and invalid roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-project-validation-"));
  const originalDataDir = storagePaths.dataDir;
  try {
    const dataDir = path.join(root, "data");
    const projectDir = path.join(root, "project");
    const file = path.join(root, "file.txt");
    fs.mkdirSync(path.join(dataDir, "nested"), { recursive: true });
    fs.mkdirSync(projectDir);
    const projectAlias = path.join(root, "project-alias");
    fs.symlinkSync(projectDir, projectAlias);
    fs.writeFileSync(file, "x");
    storagePaths.dataDir = dataDir;

    for (const invalid of ["relative", path.join(root, "missing"), file, dataDir, path.join(dataDir, "nested"), root, path.parse(root).root, os.homedir()]) {
      assert.equal(validateProjectRootPath(invalid).ok, false, invalid);
    }
    assert.deepEqual(validateProjectRootPath(projectDir), { ok: true, resolved: fs.realpathSync(projectDir) });
    assert.deepEqual(validateProjectRootPath(projectAlias), { ok: true, resolved: fs.realpathSync(projectDir) });
  } finally {
    storagePaths.dataDir = originalDataDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

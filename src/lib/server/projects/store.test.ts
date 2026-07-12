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
    const updated = store.update(first.id, { name: "Renamed", instructions: "Keep it small.", modelKey: "custom|p1|m1", thinkingLevel: "high", sandboxEnabled: false, toolProgress: "new", showReasoning: "off", runLogNotice: false });
    assert.equal(updated?.id, "my-wiki");
    assert.equal(updated?.name, "Renamed");
    assert.equal(store.get(first.id)?.modelKey, "custom|p1|m1");
    assert.equal(store.get(first.id)?.thinkingLevel, "high");
    assert.equal(store.get(first.id)?.sandboxEnabled, false);
    assert.equal(store.get(first.id)?.toolProgress, "new");
    assert.equal(store.get(first.id)?.showReasoning, "off");
    assert.equal(store.get(first.id)?.runLogNotice, false);
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

test("ProjectStore can create a unique managed directory and register it atomically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-managed-project-"));
  const managedRoot = path.join(root, "Molibot Projects");
  const store = new ProjectStore(path.join(root, "settings.sqlite"), managedRoot);
  try {
    const first = store.create({ name: "Product / Notes", createDirectory: true });
    const second = store.create({ name: "Product / Notes", createDirectory: true });
    assert.equal(fs.statSync(first.rootPath).isDirectory(), true);
    assert.equal(fs.statSync(second.rootPath).isDirectory(), true);
    assert.equal(path.dirname(first.rootPath), fs.realpathSync(managedRoot));
    assert.notEqual(first.rootPath, second.rootPath);
    assert.deepEqual(fs.readdirSync(first.rootPath), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ProjectStore persists and isolates channel conversation bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-project-binding-"));
  const dbFile = path.join(root, "settings.sqlite");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot);
  try {
    const store = new ProjectStore(dbFile);
    const project = store.create({ name: "Mobile Project", rootPath: projectRoot });
    assert.equal(store.setChannelBinding("feishu", "work", "chat-1", project.id)?.id, project.id);
    assert.equal(new ProjectStore(dbFile).getChannelBinding("feishu", "work", "chat-1")?.id, project.id);
    assert.equal(store.getChannelBinding("feishu", "other", "chat-1"), null);
    assert.equal(store.getChannelBinding("telegram", "work", "chat-1"), null);
    assert.equal(store.setChannelBinding("feishu", "work", "chat-1", null), null);
    assert.equal(store.getChannelBinding("feishu", "work", "chat-1"), null);
    assert.throws(() => store.setChannelBinding("feishu", "work", "chat-1", "missing"), /Unknown Project/);
    store.setChannelBinding("feishu", "work", "chat-1", project.id);
    store.remove(project.id);
    assert.equal(store.getChannelBinding("feishu", "work", "chat-1"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

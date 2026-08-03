import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureStorageDirs,
  requiredStorageDirs,
  storagePaths
} from "./storage.js";

/**
 * The failure this guards against is silent and only appears on an upgraded
 * install: a release adds a `*Dir` to `storagePaths`, a feature assumes it
 * exists, and a fresh-after-upgrade machine 503s because it was never created.
 * Requiring every directory key to be in the bootstrap list turns that into a
 * failed test instead of a wedged service.
 */
test("every directory in storagePaths is bootstrapped", () => {
  const dirKeys = Object.keys(storagePaths).filter((key) => key.endsWith("Dir"));
  const bootstrapped = new Set(requiredStorageDirs());
  for (const key of dirKeys) {
    const value = storagePaths[key as keyof typeof storagePaths];
    assert.equal(
      bootstrapped.has(value),
      true,
      `storagePaths.${key} (${value}) is not created by ensureStorageDirs — add it to REQUIRED_DIR_KEYS`
    );
  }
});

test("ensureStorageDirs creates missing directories and reports them once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-storage-"));
  const originals = { ...storagePaths };
  try {
    // Point every directory under a throwaway root so the real data dir is
    // never touched by the test.
    for (const key of Object.keys(storagePaths)) {
      if (key.endsWith("Dir")) {
        (storagePaths as Record<string, string>)[key] = path.join(root, key);
      }
    }

    const first = ensureStorageDirs();
    assert.equal(first.failed.length, 0);
    for (const dir of requiredStorageDirs()) {
      assert.equal(fs.existsSync(dir), true, `expected ${dir} to exist`);
    }
    assert.equal(first.created.length, requiredStorageDirs().length);

    // Idempotent: a second run creates nothing.
    const second = ensureStorageDirs();
    assert.equal(second.created.length, 0);
    assert.equal(second.failed.length, 0);
  } finally {
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ensureStorageDirs isolates a failing directory from the rest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-storage-"));
  const originals = { ...storagePaths };
  try {
    for (const key of Object.keys(storagePaths)) {
      if (key.endsWith("Dir")) {
        (storagePaths as Record<string, string>)[key] = path.join(root, key);
      }
    }
    // Make one target impossible to create by planting a file where a
    // directory must go.
    fs.writeFileSync(storagePaths.agentsDir, "not a directory", "utf8");

    const result = ensureStorageDirs();
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].path, storagePaths.agentsDir);
    // The rest were still created despite the one failure.
    assert.equal(fs.existsSync(storagePaths.miniAppCodeDir), true);
    assert.equal(fs.existsSync(storagePaths.sessionsDir), true);
  } finally {
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

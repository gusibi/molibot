import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureStorageDirs,
  requiredStorageDirs,
  settingsTestArtifactDir,
  settingsTestRoot,
  storagePaths
} from "./storage.js";

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

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

/**
 * `tooling/` is the Agent's own working directory: `wrapCommandWithVenv` puts
 * it on the Agent's PATH and points TMPDIR at it, so anything the Agent runs
 * may create and delete files anywhere inside it. `runtime/` holds the
 * ownership lock, the supervisor's state file, crash reports and the extracted
 * service code.
 *
 * Tidying the data directory by folding one into the other is a recurring
 * temptation — they do look like two flavours of "machine-generated state" —
 * and it would put the running service's own code one `rm -rf "$TMPDIR/../.."`
 * away from a Skill. Neither may contain the other, in either direction.
 */
test("agent tooling and service runtime stay disjoint trees", () => {
  assert.equal(isInside(storagePaths.runtimeDir, storagePaths.toolingDir), false);
  assert.equal(isInside(storagePaths.toolingDir, storagePaths.runtimeDir), false);
  assert.notEqual(storagePaths.runtimeDir, storagePaths.toolingDir);
  assert.equal(isInside(storagePaths.toolingDir, storagePaths.toolingPythonDir), true);
});

test("settings provider-test artifacts stay under one cache root", () => {
  for (const kind of ["image", "tts", "video"] as const) {
    assert.equal(isInside(storagePaths.settingsTestsDir, settingsTestRoot(kind)), true);
    // The video poller passes this as a data-dir-relative artifact segment, so
    // it must be relative and use forward slashes on every platform.
    const relative = settingsTestArtifactDir(kind);
    assert.equal(path.isAbsolute(relative), false);
    assert.equal(relative.includes("\\"), false);
    assert.equal(path.resolve(storagePaths.dataDir, relative), settingsTestRoot(kind));
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

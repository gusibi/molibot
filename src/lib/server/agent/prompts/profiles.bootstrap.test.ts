import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { ensureGlobalProfileDefaults, getAgentDir, getGlobalProfileDir } from "./profiles";

const EXPECTED_DEFAULTS = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md"
];

test("ensureGlobalProfileDefaults bootstraps the global profile dir without overwriting user files", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-profile-bootstrap-"));
  try {
    const created = ensureGlobalProfileDefaults(dataDir);
    assert.deepEqual(created.map((file) => path.basename(file)).sort(), EXPECTED_DEFAULTS);
    const globalDir = getGlobalProfileDir(dataDir);
    for (const fileName of EXPECTED_DEFAULTS) {
      assert.match(readFileSync(path.join(globalDir, fileName), "utf8"), /^---/);
    }

    writeFileSync(path.join(globalDir, "USER.md"), "user-owned\n", "utf8");
    assert.deepEqual(ensureGlobalProfileDefaults(dataDir), []);
    assert.equal(readFileSync(path.join(globalDir, "USER.md"), "utf8"), "user-owned\n");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("global profile dir is the default agent dir (Momo is the global identity)", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-global-profile-dir-"));
  const originalDataDir = storagePaths.dataDir;
  try {
    storagePaths.dataDir = dataDir;
    assert.equal(getGlobalProfileDir(), getAgentDir("default"));
    assert.equal(path.relative(dataDir, getGlobalProfileDir(dataDir)), path.join("agents", "default"));
  } finally {
    storagePaths.dataDir = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

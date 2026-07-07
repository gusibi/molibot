import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureGlobalProfileDefaults } from "./profiles";

const EXPECTED_DEFAULTS = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md"
];

test("ensureGlobalProfileDefaults bootstraps an empty data directory without overwriting user files", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-profile-bootstrap-"));
  try {
    const created = ensureGlobalProfileDefaults(dataDir);
    assert.deepEqual(created.map((file) => path.basename(file)).sort(), EXPECTED_DEFAULTS);
    for (const fileName of EXPECTED_DEFAULTS) {
      assert.match(readFileSync(path.join(dataDir, fileName), "utf8"), /^---/);
    }

    writeFileSync(path.join(dataDir, "USER.md"), "user-owned\n", "utf8");
    assert.deepEqual(ensureGlobalProfileDefaults(dataDir), []);
    assert.equal(readFileSync(path.join(dataDir, "USER.md"), "utf8"), "user-owned\n");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

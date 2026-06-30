import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeDesktopReleaseChecksum } from "./finalize-desktop-release.mjs";

test("writes a standard SHA-256 file beside the DMG", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "molibot-desktop-release-"));
  try {
    const dmgPath = path.join(directory, "Molibot_test.dmg");
    await writeFile(dmgPath, "molibot-desktop-test", "utf8");

    const result = await writeDesktopReleaseChecksum(dmgPath);
    assert.equal(
      result.digest,
      "c1480d184bf8ed886de364f036351cd67fd23cdc98f874c64364aca9f08143fa",
    );
    assert.equal(
      await readFile(result.checksumPath, "utf8"),
      `${result.digest}  Molibot_test.dmg\n`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

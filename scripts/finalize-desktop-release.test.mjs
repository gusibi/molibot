import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  desktopArchFromTarget,
  defaultDmgDirectory,
  finalizeDesktopRelease,
  releaseDmgName,
  writeDesktopReleaseChecksum
} from "./finalize-desktop-release.mjs";

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

test("finalizes a DMG with Desktop version and architecture in the filename", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "molibot-desktop-release-"));
  try {
    const originalPath = path.join(directory, "Molibot_0.1.0_aarch64.dmg");
    await writeFile(originalPath, "molibot-desktop-test", "utf8");

    const result = await finalizeDesktopRelease({
      dmgPath: originalPath,
      version: "2.3.3",
      target: "x86_64-apple-darwin"
    });

    assert.equal(path.basename(result.dmgPath), "Molibot_2.3.3_x86_64.dmg");
    assert.equal(
      await readFile(result.checksumPath, "utf8"),
      `${result.digest}  Molibot_2.3.3_x86_64.dmg\n`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("maps macOS Rust targets to stable DMG architecture suffixes", () => {
  assert.equal(desktopArchFromTarget("aarch64-apple-darwin"), "aarch64");
  assert.equal(desktopArchFromTarget("x86_64-apple-darwin"), "x86_64");
  assert.equal(releaseDmgName("2.3.3", "aarch64"), "Molibot_2.3.3_aarch64.dmg");
});

test("uses the host build target for default DMG finalization", () => {
  const expectedTarget = process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  assert.match(defaultDmgDirectory(), new RegExp(`/target/${expectedTarget}/release/bundle/dmg$`));
  assert.match(
    defaultDmgDirectory("x86_64-apple-darwin"),
    /\/target\/x86_64-apple-darwin\/release\/bundle\/dmg$/
  );
});

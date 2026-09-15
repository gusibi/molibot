import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("finalizes updater tarball, signature, and platform manifest when present", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "molibot-desktop-release-"));
  try {
    const dmgPath = path.join(directory, "Molibot_test.dmg");
    await writeFile(dmgPath, "molibot-dmg-test", "utf8");

    const macosDir = path.join(directory, "macos");
    await mkdir(macosDir, { recursive: true });
    const tarFile = path.join(macosDir, "Molibot.app.tar.gz");
    const sigFile = path.join(macosDir, "Molibot.app.tar.gz.sig");
    await writeFile(tarFile, "fake-tar-content", "utf8");
    await writeFile(sigFile, "fake-signature-base64", "utf8");

    const result = await finalizeDesktopRelease({
      dmgPath,
      version: "2.5.0",
      target: "aarch64-apple-darwin",
      macosDirectory: macosDir
    });

    assert.equal(path.basename(result.tarPath), "Molibot_2.5.0_aarch64.app.tar.gz");
    assert.equal(path.basename(result.sigPath), "Molibot_2.5.0_aarch64.app.tar.gz.sig");
    assert.equal(path.basename(result.platformPath), "updater-platform-aarch64.json");

    const platformJson = JSON.parse(await readFile(result.platformPath, "utf8"));
    assert.equal(platformJson.platform, "darwin-aarch64");
    assert.equal(platformJson.signature, "fake-signature-base64");
    assert.match(platformJson.url, /Molibot_2\.5\.0_aarch64\.app\.tar\.gz$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generateLatestJson combines multi-architecture updater platform files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "molibot-latest-json-"));
  try {
    const aarch64File = path.join(directory, "updater-platform-aarch64.json");
    const x86File = path.join(directory, "updater-platform-x86_64.json");

    await writeFile(aarch64File, JSON.stringify({
      platform: "darwin-aarch64",
      signature: "sig-arm",
      url: "https://example.com/arm.tar.gz"
    }), "utf8");

    await writeFile(x86File, JSON.stringify({
      platform: "darwin-x86_64",
      signature: "sig-intel",
      url: "https://example.com/intel.tar.gz"
    }), "utf8");

    const { generateLatestJson } = await import("./generate-desktop-latest-json.mjs");
    const outPath = path.join(directory, "latest.json");
    const manifest = await generateLatestJson({
      version: "2.5.0",
      notes: "Feature release",
      platformFiles: [aarch64File, x86File],
      outputPath: outPath
    });

    assert.equal(manifest.version, "v2.5.0");
    assert.equal(manifest.notes, "Feature release");
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "sig-arm");
    assert.equal(manifest.platforms["darwin-x86_64"].signature, "sig-intel");

    const saved = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(saved, manifest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planDataDirCleanup } from "./clean-data-dir.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "molibot-clean-"));
  const dir = (...parts) => {
    const target = path.join(root, ...parts);
    mkdirSync(target, { recursive: true });
    return target;
  };
  const file = (relative, contents = "x") => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
    return target;
  };
  return { root, dir, file };
}

function relatives(findings) {
  return findings.map((finding) => finding.relative);
}

test("superseded locations are reported with their reason and size", () => {
  const { root, dir, file } = fixture();
  try {
    file("settings-image-tests/test-images/a.png", "0123456789");
    dir("settings-tts-tests");
    dir("settings-video-downloads");
    dir("tooling/sandbox-venv/bin");
    file(".DS_Store");

    const findings = planDataDirCleanup(root, { processRunning: () => false });
    const names = relatives(findings);
    for (const expected of [
      "settings-image-tests",
      "settings-tts-tests",
      "settings-video-downloads",
      path.join("tooling", "sandbox-venv"),
      ".DS_Store"
    ]) {
      assert.equal(names.includes(expected), true, `expected ${expected} to be reported`);
    }
    assert.equal(findings.every((finding) => finding.reason.length > 0), true);
    const images = findings.find((finding) => finding.relative === "settings-image-tests");
    assert.equal(images.bytes, 10, "directory sizes are summed from their contents");
    assert.equal(images.safety, "safe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The sharpest edge in this script. Until `migrateLegacyDbFiles()` has run, the
 * root copy IS the live database — proposing it for deletion would destroy
 * settings, sessions and the inbound queue.
 */
test("a root database is only superseded once the migrated copy exists", () => {
  const { root, file } = fixture();
  try {
    file("settings.sqlite", "live");
    file("settings.sqlite-wal");
    file("inbound-queue.sqlite", "live");

    const before = relatives(planDataDirCleanup(root, { processRunning: () => false }));
    assert.equal(before.includes("settings.sqlite"), false);
    assert.equal(before.includes("settings.sqlite-wal"), false);
    assert.equal(before.includes("inbound-queue.sqlite"), false);

    file("db/settings.sqlite", "migrated");
    const after = relatives(planDataDirCleanup(root, { processRunning: () => false }));
    assert.equal(after.includes("settings.sqlite"), true);
    assert.equal(after.includes("settings.sqlite-wal"), true);
    // The other database has not been migrated, so it is still untouchable.
    assert.equal(after.includes("inbound-queue.sqlite"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a pid file is only stale when its process is gone", () => {
  const { root, file } = fixture();
  try {
    file("molibot-control.pid", "4242\n");
    file("molibot-dev.pid", "4243\n");

    const alive = planDataDirCleanup(root, {
      readPid: () => 4242,
      processRunning: (pid) => pid === 4242
    });
    assert.equal(relatives(alive).some((name) => name.endsWith(".pid")), false);

    const dead = planDataDirCleanup(root, { readPid: () => 4242, processRunning: () => false });
    assert.equal(relatives(dead).includes("molibot-control.pid"), true);
    assert.equal(relatives(dead).includes("molibot-dev.pid"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Everything the owner actually cares about lives in the data root next to the
 * junk. A planner that matched on shape rather than on named leftovers would
 * eventually propose one of these.
 */
test("real user data is never proposed for removal", () => {
  const { root, dir, file } = fixture();
  try {
    file("settings.json", "{}");
    file("USER.md", "# me");
    file("auth.json", "{}");
    dir("db");
    dir("memory");
    dir("projects");
    dir("sessions");
    dir("skills/my-skill");
    dir("miniapps/apps/expense");
    dir("agents");
    dir("tooling/python/venv/bin");
    dir("runtime/crashes");
    file("runtime/service.lock", "{}");
    file("cache/settings-tests/image/a.png");
    // Junk in the same directory, so the planner has something to find.
    file(".DS_Store");

    const names = relatives(planDataDirCleanup(root, { processRunning: () => false }));
    assert.deepEqual(names, [".DS_Store"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backups and raw dumps need review rather than being deleted outright", () => {
  const { root, file } = fixture();
  try {
    file("response.json", "{}");
    file("settings copy.json", "{}");
    file("skill-drafts-backup-20260613-131652.tgz", "gz");
    file("event.log", "log");

    const findings = planDataDirCleanup(root, { processRunning: () => false });
    assert.equal(findings.length, 4);
    assert.equal(findings.every((finding) => finding.safety === "review"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

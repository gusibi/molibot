import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectSkillEntry, scanSkillRoot } from "$lib/server/agent/skills/skillScan.js";

function skill(dir: string, name: string, description = `${name} description`): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`, "utf8");
}

test("scanSkillRoot reports every entry with its resolved directory and link state", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-scan-"));
  try {
    const skillsRoot = join(root, "skills");
    skill(join(skillsRoot, "plain"), "plain");
    skill(join(root, "outside", "linked"), "linked");
    symlinkSync(join(root, "outside", "linked"), join(skillsRoot, "linked"));

    const result = scanSkillRoot(skillsRoot);
    assert.equal(result.entries.length, 2);
    const linked = result.entries.find((entry) => entry.entryDir.endsWith("linked"));
    assert.ok(linked);
    assert.equal(linked.linked, true);
    assert.equal(linked.realDir, realpathSync(join(root, "outside", "linked")));

    const plain = result.entries.find((entry) => entry.entryDir.endsWith("plain"));
    assert.equal(plain?.linked, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link back to an ancestor cannot loop the scan", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-scan-cycle-"));
  try {
    skill(join(root, "skills", "nested"), "nested");
    symlinkSync(join(root, "skills"), join(root, "skills", "nested", "loop"));

    const result = scanSkillRoot(join(root, "skills"));
    assert.equal(result.entries.filter((entry) => entry.entryDir.endsWith("nested")).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dependency, repository, backup and staging directories are never scanned", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-scan-ignore-"));
  try {
    for (const name of ["node_modules", ".git", "__pycache__", "pdf.backup-2026-10-29T09-00-00-000Z", ".staging-1"]) {
      skill(join(root, "skills", name, "hidden"), `hidden-${name.replace(/[^a-z0-9]/gi, "")}`);
    }
    skill(join(root, "skills", "real"), "real");

    const result = scanSkillRoot(join(root, "skills"));
    assert.deepEqual(result.entries.map((entry) => entry.entryDir.split("/").pop()), ["real"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the scan stops at its entry budget and says so", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-scan-limit-"));
  try {
    for (let index = 0; index < 4; index += 1) skill(join(root, "skills", `s${index}`), `s${index}`);
    const result = scanSkillRoot(join(root, "skills"), { maxEntries: 2 });
    assert.equal(result.entries.length, 2);
    assert.equal(result.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectSkillEntry separates missing frontmatter from a missing name or description", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-scan-manifest-"));
  try {
    mkdirSync(join(root, "none"), { recursive: true });
    writeFileSync(join(root, "none", "SKILL.md"), "no frontmatter here\n", "utf8");
    const missing = inspectSkillEntry(join(root, "none"));
    assert.equal(missing.ok, false);
    assert.equal(missing.ok === false ? missing.code : "", "missing_frontmatter");

    mkdirSync(join(root, "nameless"), { recursive: true });
    writeFileSync(join(root, "nameless", "SKILL.md"), "---\ndescription: only a description\n---\n", "utf8");
    const nameless = inspectSkillEntry(join(root, "nameless"));
    assert.equal(nameless.ok === false ? nameless.code : "", "missing_name");

    skill(join(root, "valid"), "valid");
    const valid = inspectSkillEntry(join(root, "valid"));
    assert.equal(valid.ok, true);
    assert.equal(valid.ok ? valid.name : "", "valid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

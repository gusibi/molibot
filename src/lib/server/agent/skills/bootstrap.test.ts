import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyBuiltinSkill, ensureBuiltinSkills, listBuiltinSkillStates, type BuiltinSkill } from "$lib/server/agent/skills/bootstrap.js";
import { loadSkillsFromWorkspace } from "$lib/server/agent/skills/skills.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "molibot-skill-bootstrap-"));
}

const sample: BuiltinSkill[] = [
  {
    id: "sample-skill",
    version: "1.0.0",
    files: {
      "SKILL.md": "---\nname: sample-skill\ndescription: A sample.\n---\n\n# Sample\n",
      "template/file.txt": "hello\n"
    }
  }
];

test("installs a built-in skill into the global skills root", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    const result = ensureBuiltinSkills({ skillsRoot, skills: sample });

    assert.deepEqual(result.installed, ["sample-skill"]);
    assert.equal(
      fs.readFileSync(path.join(skillsRoot, "sample-skill", "template", "file.txt"), "utf8"),
      "hello\n"
    );
    // No staging directory may survive a successful install.
    assert.equal(fs.existsSync(path.join(skillsRoot, "sample-skill.installing")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("never overwrites an existing skill directory", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });

    const skillFile = path.join(skillsRoot, "sample-skill", "SKILL.md");
    fs.writeFileSync(skillFile, "---\nname: sample-skill\ndescription: Edited.\n---\n", "utf8");

    const second = ensureBuiltinSkills({ skillsRoot, skills: sample });
    assert.deepEqual(second.installed, []);
    assert.deepEqual(second.upgraded, []);
    assert.deepEqual(second.skipped, [{ id: "sample-skill", reason: "already-installed" }]);
    assert.match(fs.readFileSync(skillFile, "utf8"), /Edited\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a skill the owner deleted is not resurrected on the next start", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });
    fs.rmSync(path.join(skillsRoot, "sample-skill"), { recursive: true, force: true });

    const second = ensureBuiltinSkills({ skillsRoot, skills: sample });
    assert.deepEqual(second.installed, []);
    assert.deepEqual(second.skipped, [{ id: "sample-skill", reason: "removed-by-owner" }]);
    assert.equal(fs.existsSync(path.join(skillsRoot, "sample-skill")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt ledger does not block startup", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.writeFileSync(path.join(skillsRoot, ".builtin-skills.json"), "{ not json", "utf8");

    const result = ensureBuiltinSkills({ skillsRoot, skills: sample });
    assert.deepEqual(result.installed, ["sample-skill"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the shipped miniapp-creator skill loads with its template and scaffold script", () => {
  const root = tempRoot();
  try {
    // The loader derives the global skills root from a workspace path, so the
    // bootstrap target and the load path must agree — that seam is the whole
    // point of shipping the skill, and a mismatch would be invisible until a
    // packaged build.
    const skillsRoot = path.join(root, "skills");
    // A real channel workspace, so `resolveDataRootFromWorkspacePath` walks up
    // to `<root>` exactly as it does at runtime.
    const workspaceDir = path.join(root, "moli-w", "chat");
    fs.mkdirSync(workspaceDir, { recursive: true });

    const installed = ensureBuiltinSkills({ skillsRoot });
    assert.ok(installed.installed.includes("miniapp-creator"), "miniapp-creator was not installed");

    const skillDir = path.join(skillsRoot, "miniapp-creator");
    for (const relative of [
      "SKILL.md",
      "reference.md",
      "scripts/scaffold.mjs",
      "template/manifest.json",
      "template/server/index.mjs",
      "template/ui/index.html",
      "template/ui/app.js",
      "template/ui/styles.css",
      "template/ui/icon.svg"
    ]) {
      assert.ok(fs.existsSync(path.join(skillDir, relative)), `missing ${relative}`);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(skillDir, "template/manifest.json"), "utf8"));
    assert.equal(manifest.id, "starter");

    const { skills } = loadSkillsFromWorkspace(workspaceDir, "");
    const loaded = skills.find((skill) => skill.name === "miniapp-creator");
    assert.ok(loaded, "the bootstrapped skill was not discovered by the loader");
    assert.equal(loaded.scope, "global");
    assert.equal(loaded.baseDir, skillDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the shipped scaffold normalizes hyphenated app ids for SQLite identifiers", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot });
    const target = path.join(root, "expense-tracker");

    execFileSync(process.execPath, [
      path.join(skillsRoot, "miniapp-creator", "scripts", "scaffold.mjs"),
      "expense-tracker",
      "Expense Tracker",
      target
    ]);

    const server = fs.readFileSync(path.join(target, "server", "index.mjs"), "utf8");
    assert.match(server, /CREATE TABLE IF NOT EXISTS expense_tracker_records/);
    assert.doesNotMatch(server, /expense-tracker_records/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8")).id, "expense-tracker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the shipped scaffold refuses to bypass validation by writing into the live install root", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot });
    const target = path.join(root, "miniapps", "apps", "expense-tracker");

    assert.throws(() => execFileSync(process.execPath, [
      path.join(skillsRoot, "miniapp-creator", "scripts", "scaffold.mjs"),
      "expense-tracker",
      "Expense Tracker",
      target
    ], { stdio: "pipe" }), /Build in the current session scratch directory/);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** The same skill with new content and a bumped version. */
const upgraded: BuiltinSkill[] = [
  {
    id: "sample-skill",
    version: "1.1.0",
    files: {
      "SKILL.md": "---\nname: sample-skill\ndescription: A sample, fixed.\n---\n\n# Sample v2\n",
      "scripts/run.mjs": "console.log('v2');\n"
    }
  }
];

test("a version bump overwrites an untouched install in place, with no backup left behind", () => {
  const root = tempRoot();
  try {
    // Without this, a fix to a bundled Skill could never reach anyone who
    // already had it: the loader only reads the owner's workspace, and the
    // bootstrap used to skip any directory that existed.
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });

    const result = ensureBuiltinSkills({ skillsRoot, skills: upgraded });
    assert.deepEqual(result.upgraded, [{ id: "sample-skill", from: "1.0.0", to: "1.1.0", backupDir: undefined }]);

    const skillDir = path.join(skillsRoot, "sample-skill");
    assert.match(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), /Sample v2/);
    assert.equal(fs.readFileSync(path.join(skillDir, "scripts/run.mjs"), "utf8"), "console.log('v2');\n");
    // A file we shipped last time and no longer ship goes away while it still
    // matches what we wrote.
    assert.equal(fs.existsSync(path.join(skillDir, "template/file.txt")), false);
    // Nothing but the skill directory itself may survive the swap.
    assert.deepEqual(
      fs.readdirSync(skillsRoot).filter((name) => name !== ".builtin-skills.json"),
      ["sample-skill"]
    );

    // Re-running at the same version is a no-op again.
    const third = ensureBuiltinSkills({ skillsRoot, skills: upgraded });
    assert.deepEqual(third.upgraded, []);
    assert.deepEqual(third.skipped, [{ id: "sample-skill", reason: "already-installed" }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an upgrade over owner edits keeps the previous tree instead of destroying it", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });
    const skillDir = path.join(skillsRoot, "sample-skill");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: sample-skill\ndescription: Mine.\n---\n", "utf8");
    fs.writeFileSync(path.join(skillDir, "notes.md"), "my notes\n", "utf8");

    const result = ensureBuiltinSkills({ skillsRoot, skills: upgraded });
    const [entry] = result.upgraded;
    assert.equal(entry?.id, "sample-skill");
    assert.ok(entry?.backupDir, "an edited tree must be preserved, not silently replaced");

    // The new version is live...
    assert.match(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), /Sample v2/);
    // ...the owner's own file rides along...
    assert.equal(fs.readFileSync(path.join(skillDir, "notes.md"), "utf8"), "my notes\n");
    // ...and their edit is still recoverable.
    assert.match(fs.readFileSync(path.join(entry!.backupDir!, "SKILL.md"), "utf8"), /Mine\./);
    // A file the owner took over is not deleted as "stale", even when we
    // stopped shipping it.
    assert.equal(fs.existsSync(path.join(entry!.backupDir!, "template/file.txt")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an install of unknown provenance is treated as the owner's on upgrade", () => {
  const root = tempRoot();
  try {
    // A hand-installed directory (adopted, so no recorded hashes) and a legacy
    // ledger entry written before hashes existed look identical here: we cannot
    // prove the content is ours, so an upgrade must not throw it away.
    const skillsRoot = path.join(root, "skills");
    const skillDir = path.join(skillsRoot, "sample-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: sample-skill\ndescription: Hand rolled.\n---\n", "utf8");

    // First pass adopts it at the current version — no upgrade yet.
    const adopted = ensureBuiltinSkills({ skillsRoot, skills: sample });
    assert.deepEqual(adopted.skipped, [{ id: "sample-skill", reason: "already-installed" }]);
    assert.deepEqual(adopted.upgraded, []);
    assert.match(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), /Hand rolled\./);

    const result = ensureBuiltinSkills({ skillsRoot, skills: upgraded });
    assert.ok(result.upgraded[0]?.backupDir, "an adopted directory has no proof of provenance");
    assert.match(fs.readFileSync(path.join(result.upgraded[0]!.backupDir!, "SKILL.md"), "utf8"), /Hand rolled\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a ledger cannot make the upgrade delete outside the skill directory", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });

    // Stale-file cleanup is driven by paths read back from a JSON file on disk.
    const outside = path.join(root, "secret.txt");
    fs.writeFileSync(outside, "keep me\n", "utf8");
    const ledgerPath = path.join(skillsRoot, ".builtin-skills.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    ledger["sample-skill"].files["../../secret.txt"] = "deadbeef";
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");

    ensureBuiltinSkills({ skillsRoot, skills: upgraded });
    assert.equal(fs.readFileSync(outside, "utf8"), "keep me\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The boot path upgrades on a version bump on its own, so these two cases are
// what the Settings button exists for: a copy the owner edited (no version
// change, so boot leaves it alone) and one they deleted (boot honours the
// tombstone, an explicit request overrides it).
test("applying a built-in skill on request repairs an edited copy at the same version", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });
    const skillDir = path.join(skillsRoot, "sample-skill");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: sample-skill\ndescription: Mine.\n---\n", "utf8");

    let [state] = listBuiltinSkillStates({ skillsRoot, skills: sample });
    assert.equal(state.installed, true);
    assert.equal(state.installedVersion, "1.0.0");
    // Same version, so nothing to upgrade — but the copy no longer matches what
    // we wrote, which is what makes the button meaningful.
    assert.equal(state.updateAvailable, false);
    assert.equal(state.modified, true);

    const applied = applyBuiltinSkill({ skillsRoot, skills: sample, id: "sample-skill" });
    assert.equal(applied.installed, false);
    assert.ok(applied.backupDir, "an edited copy must be preserved, not silently replaced");
    assert.match(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), /A sample\./);

    [state] = listBuiltinSkillStates({ skillsRoot, skills: sample });
    assert.equal(state.modified, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applying a built-in skill on request reinstalls one the owner deleted", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    ensureBuiltinSkills({ skillsRoot, skills: sample });
    fs.rmSync(path.join(skillsRoot, "sample-skill"), { recursive: true, force: true });

    // Boot keeps honouring the tombstone; only an explicit request brings it back.
    assert.deepEqual(
      ensureBuiltinSkills({ skillsRoot, skills: sample }).skipped,
      [{ id: "sample-skill", reason: "removed-by-owner" }]
    );
    assert.equal(listBuiltinSkillStates({ skillsRoot, skills: sample })[0].installed, false);

    const applied = applyBuiltinSkill({ skillsRoot, skills: upgraded, id: "sample-skill" });
    assert.equal(applied.installed, true);
    assert.equal(applied.to, "1.1.0");
    assert.match(fs.readFileSync(path.join(skillsRoot, "sample-skill", "SKILL.md"), "utf8"), /Sample v2/);

    const [state] = listBuiltinSkillStates({ skillsRoot, skills: upgraded });
    assert.equal(state.installed, true);
    assert.equal(state.updateAvailable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown built-in skill id is refused rather than materialising a directory", () => {
  const root = tempRoot();
  try {
    const skillsRoot = path.join(root, "skills");
    assert.throws(() => applyBuiltinSkill({ skillsRoot, skills: sample, id: "../escape" }), /Unknown built-in skill/);
    assert.equal(fs.existsSync(path.join(root, "escape")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

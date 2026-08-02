import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureBuiltinSkills, type BuiltinSkill } from "$lib/server/agent/skills/bootstrap.js";
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

import assert from "node:assert/strict";
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listSkillDirectory, readSkillFileContent } from "$lib/server/skills/preview.js";

test("listSkillDirectory lists directories first and reads inside the Skill only", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-skill-preview-"));
  try {
    mkdirSync(join(root, "references"), { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "---\nname: sample\n---\n", "utf8");
    writeFileSync(join(root, "references", "notes.md"), "# Notes", "utf8");
    writeFileSync(join(root, "..", "outsider.txt"), "secret", "utf8");
    symlinkSync(join(root, "..", "outsider.txt"), join(root, "escape.txt"));
    symlinkSync(join(root, "references"), join(root, "references-link"));

    const entries = listSkillDirectory(root);
    assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.path}`), [
      "dir:references",
      "dir:references-link",
      "file:escape.txt",
      "file:references-link/notes.md",
      "file:references/notes.md",
      "file:SKILL.md"
    ]);

    assert.equal(readSkillFileContent(root, "references/notes.md").content, "# Notes");
    assert.throws(() => readSkillFileContent(root, "../outsider.txt"), /escapes the Skill directory/);
    assert.throws(() => readSkillFileContent(root, "escape.txt"), /escapes the Skill directory/);
    assert.throws(() => readSkillFileContent(root, "missing.md"), /File not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preview reads a bounded prefix even when the file exceeds Node's whole-file limit", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-skill-truncate-"));
  try {
    writeFileSync(join(root, "SKILL.md"), "---\nname: sample\n---\n", "utf8");
    const huge = join(root, "huge.txt");
    const descriptor = openSync(huge, "w");
    ftruncateSync(descriptor, 1024 * 1024 * 1024 + 64);
    closeSync(descriptor);

    const preview = readSkillFileContent(root, "huge.txt");
    assert.equal(preview.truncated, true);
    assert.equal(preview.binary, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

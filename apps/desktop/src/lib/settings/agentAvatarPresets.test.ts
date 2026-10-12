import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentAvatarPresets } from "./agentAvatarPresets";

test("avatar presets derive from the directory with natural sort and stable public URLs", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-avatars-"));
  for (const file of ["pattern-2.svg", "pattern-10.svg", "pattern-1.svg", "scifi-momo.svg", "notes.txt", ".DS_Store", "cover.webp"]) {
    writeFileSync(join(dir, file), "x");
  }
  const presets = listAgentAvatarPresets(dir);
  assert.deepEqual(presets.map(preset => preset.src), [
    "/agent-avatars/cover.webp",
    "/agent-avatars/pattern-1.svg",
    "/agent-avatars/pattern-2.svg",
    "/agent-avatars/pattern-10.svg",
    "/agent-avatars/scifi-momo.svg"
  ]);
});

test("avatar preset labels stay bilingual and humanized per prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-avatars-"));
  writeFileSync(join(dir, "pattern-3.svg"), "x");
  writeFileSync(join(dir, "scifi-code-reviewer.svg"), "x");
  writeFileSync(join(dir, "custom-glyph.svg"), "x");
  const presets = listAgentAvatarPresets(dir);
  assert.deepEqual(presets[0], {
    src: "/agent-avatars/custom-glyph.svg",
    zh: "custom glyph",
    en: "custom glyph"
  });
  assert.equal(presets[1].zh, "色块头像 3");
  assert.equal(presets[1].en, "Pattern avatar 3");
  assert.equal(presets[2].zh, "科幻头像 Code reviewer");
  assert.equal(presets[2].en, "Sci-fi avatar Code reviewer");
});

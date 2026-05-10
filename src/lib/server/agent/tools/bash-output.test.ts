import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBashTool } from "./bash.js";
import { normalizeCommandOutput } from "./helpers.js";
import { truncateMiddle } from "./truncate.js";

test("normalizeCommandOutput keeps final carriage-return update", () => {
  const raw = "start\nprogress 10%\rprogress 50%\rprogress 100%\nend";
  const normalized = normalizeCommandOutput(raw);
  assert.equal(normalized, "start\nprogress 100%\nend");
});

test("truncateMiddle preserves both opening and closing context", () => {
  const raw = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");
  const truncated = truncateMiddle(raw, { maxLines: 6, maxBytes: 200, headLines: 2, tailLines: 3 });
  assert.equal(truncated.truncated, true);
  assert.match(truncated.content, /^line-1\nline-2\n\[\.\.\. 7 lines omitted \.\.\.\]\nline-10\nline-11\nline-12$/);
});

test("bash exposes dated artifact directory to shell commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf '%s' \"$MOLIBOT_SCRATCH_ARTIFACT_DIR\""
    });

    assert.equal(result.content[0]?.text, "2026/05/10");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash relocates newly generated root artifacts into dated artifact directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf 'image' > flying_pig_cartoon.png"
    });

    assert.equal(existsSync(join(cwd, "flying_pig_cartoon.png")), false);
    assert.equal(readFileSync(join(cwd, "2026/05/10/flying_pig_cartoon.png"), "utf8"), "image");
    assert.match(result.content[0]?.text ?? "", /Moved generated artifact\(s\).*2026\/05\/10\/flying_pig_cartoon\.png/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash leaves non-artifact root support files in place", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    await tool.execute("tool-1", {
      label: "bash",
      command: "printf '{}' > package.json"
    });

    assert.equal(readFileSync(join(cwd, "package.json"), "utf8"), "{}");
    assert.equal(existsSync(join(cwd, "2026/05/10/package.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

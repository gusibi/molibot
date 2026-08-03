import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProjectFileReference,
  parseProjectFileReferences
} from "./projectFileReference";

test("formats a Project file reference with a readable name and authoritative path", () => {
  assert.equal(
    formatProjectFileReference("02-内容创作/02-图文长文/04-agent-runtime-object-model.md"),
    "@[04-agent-runtime-object-model.md](02-内容创作/02-图文长文/04-agent-runtime-object-model.md)"
  );
  assert.equal(formatProjectFileReference("src/a.ts", 42), "@[a.ts:42](src/a.ts:42)");
});

test("round-trips spaces, brackets, parentheses and a line suffix", () => {
  const rendered = formatProjectFileReference("docs/a [draft] (final).md", 7);
  const [reference] = parseProjectFileReferences(`review ${rendered} now`);
  assert.deepEqual(reference, {
    raw: rendered,
    displayName: "a [draft] (final).md:7",
    path: "docs/a [draft] (final).md",
    line: 7,
    start: 7,
    end: 7 + rendered.length
  });
});

test("does not treat the old bare @path form as a structured file reference", () => {
  assert.deepEqual(parseProjectFileReferences("read @docs/a.md"), []);
});

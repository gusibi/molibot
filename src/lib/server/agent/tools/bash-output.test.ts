import test from "node:test";
import assert from "node:assert/strict";
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

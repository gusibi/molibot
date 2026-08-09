import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { DOCX_MAX_BYTES, parseDocx } from "./docx";

const require = createRequire(import.meta.url);

test("parseDocx renders a DOCX fixture as read-only Markdown", async () => {
  const mammothPackage = require.resolve("mammoth/package.json");
  const fixture = await readFile(join(dirname(mammothPackage), "test", "test-data", "single-paragraph.docx"));
  const parsed = await parseDocx(fixture);

  assert.match(parsed.markdown, /Walking on imported air/);
  assert.deepEqual(parsed.warnings, []);
});

test("parseDocx rejects malformed bytes before the viewer can mount them", async () => {
  await assert.rejects(() => parseDocx(new Uint8Array([1, 2, 3, 4])), /file|zip|central directory|end of central/i);
  assert.equal(DOCX_MAX_BYTES, 50 * 1024 * 1024);
});

import test from "node:test";
import assert from "node:assert/strict";
import { PPTX_MAX_BYTES, preparePptxBytes } from "./pptx";

test("preparePptxBytes copies only the authorized byte window", () => {
  const backing = new Uint8Array([9, 1, 2, 8]);
  const view = backing.subarray(1, 3);
  const result = preparePptxBytes(view);

  assert.deepEqual(Array.from(new Uint8Array(result)), [1, 2]);
  backing[1] = 7;
  assert.deepEqual(Array.from(new Uint8Array(result)), [1, 2]);
});

test("preparePptxBytes rejects archives above the preview budget", () => {
  assert.throws(
    () => preparePptxBytes(new Uint8Array(PPTX_MAX_BYTES + 1)),
    /PPTX is too large to preview/
  );
});

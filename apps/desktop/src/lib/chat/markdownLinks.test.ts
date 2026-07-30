import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExternalHttpUrl } from "./markdownLinks";

test("markdown links only delegate HTTP(S) URLs to the system browser", () => {
  assert.equal(normalizeExternalHttpUrl("https://example.com/docs?q=1"), "https://example.com/docs?q=1");
  assert.equal(normalizeExternalHttpUrl("http://localhost:6767/status"), "http://localhost:6767/status");
  assert.equal(normalizeExternalHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeExternalHttpUrl("file:///tmp/private"), null);
  assert.equal(normalizeExternalHttpUrl("not a url"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "molibot-media-test-route-"));
const { POST } = await import("./+server.js");

test("invalid provider is rejected before starting media generation", async () => {
  const response = await POST({
    request: new Request("http://localhost/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "invalid-provider" })
    })
  } as Parameters<typeof POST>[0]);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "Invalid TTS provider" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseStreamRequest } from "./request";

test("stream request accepts image attachments as multipart form data", async () => {
  const form = new FormData();
  form.set("profileId", "personal");
  form.set("conversationId", "session-1");
  form.set("message", "describe this");
  form.set("thinkingLevel", "medium");
  form.append("files", new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }));

  const parsed = await parseStreamRequest(new Request("http://localhost/api/stream", {
    method: "POST",
    body: form
  }));

  assert.equal(parsed.profileId, "personal");
  assert.equal(parsed.conversationId, "session-1");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]?.name, "shot.png");
  assert.equal(parsed.files[0]?.type, "image/png");
});

test("stream request keeps JSON turns backward compatible", async () => {
  const parsed = await parseStreamRequest(new Request("http://localhost/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId: "personal", message: "hello" })
  }));

  assert.equal(parsed.message, "hello");
  assert.deepEqual(parsed.files, []);
});

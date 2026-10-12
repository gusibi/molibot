import assert from "node:assert/strict";
import test from "node:test";
import { deleteConversationSelection } from "./deleteConversationSelection";

test("deletion targets only unique selected conversations and reports partial failure", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.kind, "delete");
    assert.deepEqual(request.targets, [{conversationId: "a"}, {conversationId: "b"}]);
    assert.ok(request.idempotencyKey);
    return new Response(JSON.stringify({items: [
      {conversationId: "a", status: "succeeded"},
      {conversationId: "b", status: "skipped", reason: "running"},
    ]}), {headers: {"content-type": "application/json"}});
  };
  try {
    assert.deepEqual(await deleteConversationSelection("http://fixture.invalid", ["a", "b", "a"]), {deletedIds: ["a"], error: "b: running"});
  } finally { globalThis.fetch = previous; }
});

test("network failure rejects deletion without claiming successful removals", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { await assert.rejects(deleteConversationSelection("http://fixture.invalid", ["a"]), /offline/); }
  finally { globalThis.fetch = previous; }
});

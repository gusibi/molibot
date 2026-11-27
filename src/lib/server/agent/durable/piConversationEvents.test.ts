import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationView, EntryRecord, Observer } from "@earendil-works/pi-durable";
import { observePiConversation } from "./piConversationEvents.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(entries: (id: Conversation["id"]) => readonly EntryRecord[] = () => []) {
  let observer!: Observer<ConversationView>;
  let detached = false;
  const conversation = { id: 1 as Conversation["id"] };
  const history = entries(conversation.id);
  function view(pollAt?: number): ConversationView {
    return { conversation, entries: history, docs: pollAt === undefined ? {} : { "pi.live": { generation: { deferred: { pollAt } } } } };
  }
  const harness = {
    async observeConversation(_id, current) {
      observer = current;
      return { value: view(), detach() { detached = true; } };
    },
    async snapshot() { throw new Error("Unexpected snapshot"); },
    async getTask() { throw new Error("Unexpected task lookup"); },
  } satisfies Parameters<typeof observePiConversation>[0];

  return {
    harness,
    conversation,
    advance(pollAt: number) {
      observer.advance({ kind: "value", value: view(pollAt), ops: [], retired: false }, BACKGROUND_CONTEXT);
    },
    end(error: Error) { observer.end({ kind: "failed", error }); },
    get detached() { return detached; }
  };
}

test("an unexpected source close drains every accepted update, then reports the source failure", async () => {
  const source = fixture();
  const processing = deferred();
  const release = deferred();
  const delivered: number[] = [];
  const watch = await observePiConversation(source.harness, source.conversation, BACKGROUND_CONTEXT, async events => {
    for (const event of events) {
      if (event.type !== "deferred_poll") continue;
      if (event.pollAt === 1) {
        processing.resolve();
        await release.promise;
      }
      delivered.push(event.pollAt);
    }
  });
  watch.start();
  source.advance(1);
  await processing.promise;
  source.advance(2);
  const error = new Error("source disconnected");
  source.end(error);
  release.resolve();
  assert.deepEqual(await watch.closed, { kind: "failed", error });
  assert.deepEqual(delivered, [1, 2]);
  await assert.rejects(watch.flush(), error);
  await assert.rejects(watch.failure, error);
});

test("a listener rejection detaches the producer and rejects pending projection", async () => {
  const source = fixture();
  const error = new Error("projection failed");
  const watch = await observePiConversation(source.harness, source.conversation, BACKGROUND_CONTEXT, async () => { throw error; });
  watch.start();
  source.advance(1);
  assert.deepEqual(await watch.closed, { kind: "listener_error", error });
  assert.equal(source.detached, true);
  await assert.rejects(watch.flush(), error);
  await assert.rejects(watch.failure, error);
});

test("stopping before start detaches and drains queued updates exactly once", async () => {
  const source = fixture();
  const delivered: number[] = [];
  const watch = await observePiConversation(source.harness, source.conversation, BACKGROUND_CONTEXT, async events => {
    for (const event of events) if (event.type === "deferred_poll") delivered.push(event.pollAt);
  });
  source.advance(1);
  source.advance(2);
  assert.deepEqual(await watch.stop(), { kind: "stopped" });
  assert.equal(source.detached, true);
  assert.deepEqual(delivered, [1, 2]);
  await watch.flush();
});

test("progress-only revisions leave historical tool arguments unread", async () => {
  const source = fixture(conversationId => [{
    id: 1 as EntryRecord["id"],
    conversationId,
    kind: "message",
    get model(): never { throw new Error("A progress-only update scanned historical messages"); }
  }]);
  const updates: number[] = [];
  const watch = await observePiConversation(source.harness, source.conversation, BACKGROUND_CONTEXT, async events => {
    for (const event of events) if (event.type === "deferred_poll") updates.push(event.pollAt);
  });
  watch.start();
  source.advance(42);
  await watch.flush();
  assert.deepEqual(updates, [42]);
  await watch.stop();
});

import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SqliteOutbox } from "./outbox.js";

test("SqliteOutbox resolves an enqueued message after successful delivery", async () => {
  const delivered: string[] = [];
  const outbox = new SqliteOutbox<{ chatId: string; text: string }, { ok: true }>({
    channel: "test",
    instanceId: "bot-1",
    dbFile: ":memory:",
    retryDelayMs: 10,
    deliver: async (payload) => {
      delivered.push(payload.text);
      return { ok: true };
    }
  });

  const result = await outbox.enqueue("chat-1", { chatId: "chat-1", text: "queued text" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delivered, ["queued text"]);
  assert.equal(outbox.pendingCount("chat-1"), 0);
  outbox.close();
});

test("SqliteOutbox keeps enqueue pending across retryable failures and resolves after retry", async () => {
  const delivered: string[] = [];
  let attempt = 0;
  const outbox = new SqliteOutbox<{ chatId: string; text: string }, { ok: true }>({
    channel: "test",
    instanceId: "bot-2",
    dbFile: ":memory:",
    retryDelayMs: 10,
    deliver: async (payload) => {
      attempt += 1;
      delivered.push(`${attempt}:${payload.text}`);
      if (attempt === 1) {
        throw new Error("first attempt failed");
      }
      return { ok: true };
    }
  });

  const enqueuePromise = outbox.enqueue("chat-1", { chatId: "chat-1", text: "retry me" });

  await delay(20);
  const result = await enqueuePromise;

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delivered, ["1:retry me", "2:retry me"]);
  assert.equal(outbox.pendingCount("chat-1"), 0);
  outbox.close();
});

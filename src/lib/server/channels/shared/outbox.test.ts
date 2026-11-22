import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { OutboxDeliveryError, SqliteOutbox } from "$lib/server/channels/shared/outbox.js";

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

  await delay(25);
  const result = await enqueuePromise;

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delivered, ["1:retry me", "2:retry me"]);
  assert.equal(outbox.pendingCount("chat-1"), 0);
  outbox.close();
});

test("SqliteOutbox deduplicates by deliveryKey and retains receipt across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-outbox-dedupe-"));
  const dbFile = join(dir, "outbox.sqlite");
  let deliverCalls = 0;
  try {
    const outbox1 = new SqliteOutbox<{ text: string }, { messageId: string }>({
      channel: "telegram",
      instanceId: "bot-1",
      dbFile,
      retryDelayMs: 10,
      deliver: async (payload) => {
        deliverCalls += 1;
        await delay(15);
        return { messageId: `msg-${deliverCalls}-${payload.text}` };
      }
    });

    // Concurrent enqueues with the same key share a single delivery.
    const [r1, r2] = await Promise.all([
      outbox1.enqueue("chat-1", { text: "hello" }, { deliveryKey: "fu-1:rev1:slot1" }),
      outbox1.enqueue("chat-1", { text: "hello" }, { deliveryKey: "fu-1:rev1:slot1" })
    ]);
    assert.deepEqual(r1, { messageId: "msg-1-hello" });
    assert.deepEqual(r2, { messageId: "msg-1-hello" });
    assert.equal(deliverCalls, 1);

    // Replay after completion returns the retained receipt without re-delivering.
    const r3 = await outbox1.enqueue("chat-1", { text: "hello" }, { deliveryKey: "fu-1:rev1:slot1" });
    assert.deepEqual(r3, { messageId: "msg-1-hello" });
    assert.equal(deliverCalls, 1);

    const receipt1 = outbox1.getReceipt("fu-1:rev1:slot1");
    assert.equal(receipt1?.status, "sent");
    assert.deepEqual(receipt1?.result, { messageId: "msg-1-hello" });
    outbox1.close();

    // Restart on the same DB still honors the retained receipt.
    const outbox2 = new SqliteOutbox<{ text: string }, { messageId: string }>({
      channel: "telegram",
      instanceId: "bot-1",
      dbFile,
      retryDelayMs: 10,
      deliver: async () => {
        deliverCalls += 1;
        return { messageId: "should-not-send" };
      }
    });
    const r4 = await outbox2.enqueue("chat-1", { text: "hello" }, { deliveryKey: "fu-1:rev1:slot1" });
    assert.deepEqual(r4, { messageId: "msg-1-hello" });
    assert.equal(deliverCalls, 1);
    outbox2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteOutbox rejects expired messages without calling deliver", async () => {
  let now = 100_000;
  let delivered = 0;
  const outbox = new SqliteOutbox<{ text: string }, { ok: true }>({
    channel: "telegram",
    instanceId: "bot-1",
    dbFile: ":memory:",
    now: () => now,
    deliver: async () => {
      delivered += 1;
      return { ok: true };
    }
  });

  await assert.rejects(
    () => outbox.enqueue("chat-1", { text: "stale" }, { deliveryKey: "exp-1", expiresAt: now - 1 }),
    (err: unknown) => err instanceof OutboxDeliveryError && err.status === "expired"
  );
  assert.equal(delivered, 0);
  assert.equal(outbox.getReceipt("exp-1")?.status, "expired");
  outbox.close();
});

test("SqliteOutbox pre-send gate cancels delivery before invoking transport", async () => {
  let delivered = 0;
  let revoked = false;
  const outbox = new SqliteOutbox<{ text: string }, { ok: true }>({
    channel: "telegram",
    instanceId: "bot-1",
    dbFile: ":memory:",
    retryDelayMs: 15,
    beforeDeliver: async () => {
      if (revoked) return { allow: false, reason: "authorization revoked", status: "cancelled" };
      return { allow: true };
    },
    deliver: async () => {
      delivered += 1;
      if (delivered === 1) {
        revoked = true;
        throw new Error("transient network error");
      }
      return { ok: true };
    }
  });

  await assert.rejects(
    () => outbox.enqueue("chat-1", { text: "check" }, { deliveryKey: "gate-1" }),
    (err: unknown) => err instanceof OutboxDeliveryError && err.status === "cancelled" && /revoked/.test(err.message)
  );
  assert.equal(delivered, 1);
  assert.equal(outbox.getReceipt("gate-1")?.status, "cancelled");
  assert.equal(outbox.pendingCount("chat-1"), 0);
  outbox.close();
});

test("SqliteOutbox stops immediately on permanent error and bounds retryable attempts", async () => {
  let permCalls = 0;
  const permOutbox = new SqliteOutbox<{ text: string }, { ok: true }>({
    channel: "telegram",
    instanceId: "bot-perm",
    dbFile: ":memory:",
    retryDelayMs: 10,
    maxAttempts: 5,
    classifyError: (err) => (/403|blocked/i.test(String(err)) ? "permanent" : "retryable"),
    deliver: async () => {
      permCalls += 1;
      throw new Error("403 Forbidden: bot was blocked by the user");
    }
  });

  await assert.rejects(
    () => permOutbox.enqueue("chat-1", { text: "hi" }, { deliveryKey: "perm-1" }),
    (err: unknown) => err instanceof OutboxDeliveryError && err.status === "failed" && err.attemptCount === 1
  );
  assert.equal(permCalls, 1);
  assert.equal(permOutbox.getReceipt("perm-1")?.status, "failed");
  permOutbox.close();

  let retryCalls = 0;
  const retryOutbox = new SqliteOutbox<{ text: string }, { ok: true }>({
    channel: "telegram",
    instanceId: "bot-retry",
    dbFile: ":memory:",
    retryDelayMs: 5,
    maxRetryDelayMs: 15,
    maxAttempts: 3,
    deliver: async () => {
      retryCalls += 1;
      throw new Error("503 Service Unavailable");
    }
  });

  await assert.rejects(
    () => retryOutbox.enqueue("chat-1", { text: "hi" }, { deliveryKey: "retry-1" }),
    (err: unknown) => err instanceof OutboxDeliveryError && err.status === "failed" && err.attemptCount === 3
  );
  assert.equal(retryCalls, 3);
  assert.equal(retryOutbox.getReceipt("retry-1")?.status, "failed");
  retryOutbox.close();
});

test("SqliteOutbox marks unknown on uncertain error or crash during sending without resending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-outbox-unknown-"));
  const dbFile = join(dir, "outbox.sqlite");
  try {
    // Case 1: classifier marks error as unknown
    let calls = 0;
    const outbox1 = new SqliteOutbox<{ text: string }, { ok: true }>({
      channel: "telegram",
      instanceId: "bot-1",
      dbFile,
      classifyError: () => "unknown",
      deliver: async () => {
        calls += 1;
        throw new Error("socket hang up after write");
      }
    });
    await assert.rejects(
      () => outbox1.enqueue("chat-1", { text: "uncertain" }, { deliveryKey: "unk-1" }),
      (err: unknown) => err instanceof OutboxDeliveryError && err.status === "unknown"
    );
    assert.equal(calls, 1);
    assert.equal(outbox1.getReceipt("unk-1")?.status, "unknown");
    outbox1.close();

    // Case 2: crash after entering sending (lease expired) on a keyed delivery
    const db = new DatabaseSync(dbFile);
    const pastIso = new Date(1000).toISOString();
    db.prepare(`
      INSERT INTO outbound_messages (
        channel, instance_id, chat_id, delivery_key, status, payload_json,
        attempt_count, next_attempt_at, lease_until, sending_at, last_error,
        created_at, updated_at, completed_at, result_json
      ) VALUES ('telegram', 'bot-1', 'chat-1', 'unk-crash', 'sending', '{"text":"in-flight"}',
        0, 1000, 1500, 1000, NULL, ?, ?, NULL, NULL)
    `).run(pastIso, pastIso);
    db.close();

    let restartedCalls = 0;
    const outbox2 = new SqliteOutbox<{ text: string }, { ok: true }>({
      channel: "telegram",
      instanceId: "bot-1",
      dbFile,
      now: () => 50_000,
      deliver: async () => {
        restartedCalls += 1;
        return { ok: true };
      }
    });
    await outbox2.resume();
    assert.equal(restartedCalls, 0);
    assert.equal(outbox2.getReceipt("unk-crash")?.status, "unknown");
    outbox2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteOutbox migrates a legacy outbound_messages table without losing pending rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-outbox-legacy-"));
  const dbFile = join(dir, "outbox.sqlite");
  try {
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE outbound_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        lease_until INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT
      );
    `);
    const nowIso = new Date(1000).toISOString();
    db.prepare(`
      INSERT INTO outbound_messages (
        channel, instance_id, chat_id, status, payload_json,
        attempt_count, next_attempt_at, lease_until, last_error,
        created_at, updated_at, completed_at, result_json
      ) VALUES ('feishu', 'bot-legacy', 'chat-1', 'pending', '{"text":"from-legacy"}', 0, 1000, NULL, NULL, ?, ?, NULL, NULL)
    `).run(nowIso, nowIso);
    db.close();

    const delivered: string[] = [];
    const outbox = new SqliteOutbox<{ text: string }, { ok: true }>({
      channel: "feishu",
      instanceId: "bot-legacy",
      dbFile,
      deliver: async (payload) => {
        delivered.push(payload.text);
        return { ok: true };
      }
    });
    await outbox.resume();
    assert.deepEqual(delivered, ["from-legacy"]);
    assert.equal(outbox.pendingCount("chat-1"), 0);
    outbox.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteOutbox cancel stops a pending delivery and pruneReceipts clears old terminal rows", async () => {
  let now = 1_000_000;
  let deliverCalls = 0;
  const outbox = new SqliteOutbox<{ text: string }, { ok: true }>({
    channel: "telegram",
    instanceId: "bot-prune",
    dbFile: ":memory:",
    retryDelayMs: 500,
    retentionMs: 10_000,
    now: () => now,
    deliver: async (payload) => {
      deliverCalls += 1;
      if (payload.text === "flaky") throw new Error("temporary failure");
      return { ok: true };
    }
  });

  // 1) Successful delivery creates a retained receipt, later pruned past retentionMs.
  await outbox.enqueue("chat-1", { text: "ok" }, { deliveryKey: "done-1" });
  assert.equal(outbox.getReceipt("done-1")?.status, "sent");

  // 2) Flaky delivery fails first attempt, enters pending backoff, then gets cancelled before retry.
  const flakyPromise = outbox.enqueue("chat-1", { text: "flaky" }, { deliveryKey: "cancel-1" });
  await delay(15);
  const cancelled = outbox.cancel("cancel-1", "user cancelled follow-up");
  assert.deepEqual(cancelled, { cancelled: true, status: "cancelled" });
  await assert.rejects(
    () => flakyPromise,
    (err: unknown) => err instanceof OutboxDeliveryError && err.status === "cancelled"
  );
  assert.equal(deliverCalls, 2);

  // 3) Advance clock past retentionMs and prune.
  now += 20_000;
  const pruned = outbox.pruneReceipts();
  assert.equal(pruned, 2);
  assert.equal(outbox.getReceipt("done-1"), null);
  assert.equal(outbox.getReceipt("cancel-1"), null);
  outbox.close();
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoryMemoryBackend } from "./moryCore.js";

test("memory list reports persisted vectors before and after backfill and reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-vector-status-"));
  const dbPath = join(dir, "mory.sqlite");
  const scope = { channel: "web" as const, externalUserId: "test", ownerId: "owner" };
  try {
    const backend = new MoryMemoryBackend({} as any, { dbPath, dataDir: dir });
    const record = await backend.add(scope, {
      content: "测试用户偏好简洁清晰的回答风格", namespace: "owner:owner", domain: "owner",
      type: "user_preference", subject: "answer_style", reason: "user_explicit"
    });
    assert.equal((await backend.searchAll({ query: "" }))[0].hasEmbedding, false);
    backend.configureEmbedder(async () => { throw new Error("model unavailable"); }, "test:v1");
    await assert.rejects(backend.backfillEmbeddings(), /model unavailable/);
    assert.equal((await backend.get(scope, record.id))?.hasEmbedding, false);
    backend.configureEmbedder(async () => [0.1, 0.2, 0.3], "test:v1");
    assert.equal((await backend.backfillEmbeddings()).updatedCount, 1);
    assert.equal((await backend.searchAll({ query: "" }))[0].hasEmbedding, true);
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT l1_summary, embedding FROM memory_nodes WHERE id = ?").get(record.id)!;
      assert.equal(row.l1_summary, record.content);
      assert.deepEqual(JSON.parse(String(row.embedding)), [0.1, 0.2, 0.3]);
    } finally { db.close(); }
    const reopened = new MoryMemoryBackend({} as any, { dbPath, dataDir: dir });
    assert.equal((await reopened.searchAll({ query: "" }))[0].hasEmbedding, true);
    assert.equal((await reopened.get(scope, record.id))?.content, record.content);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MoryMemoryBackend } from "./moryCore.js";

test("all-scope search uses the embedding path instead of lexical ranking", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-mory-search-all-"));
  const backend = new MoryMemoryBackend({} as never, { dbPath: join(dir, "mory.sqlite"), dataDir: dir });
  const scope = { channel: "web", externalUserId: "web:momo:chat", botId: "momo", ownerId: "owner" };
  const embedder = async (text: string) => (
    text.includes("花生") || text.includes("忌口") ? [1, 0] : [0, 1]
  );
  try {
    backend.configureEmbedder(embedder, "provider:model-a");
    await backend.add(scope, {
      content: "花生会让身体起疹子",
      domain: "owner",
      type: "user_fact",
      subject: "diet.peanut",
      layer: "long_term"
    });
    await backend.add(scope, {
      content: "今天天气很好",
      domain: "owner",
      type: "user_fact",
      subject: "daily.weather",
      layer: "long_term"
    });

    const results = await backend.searchAll({ query: "有哪些忌口", limit: 10 });
    assert.deepEqual(results.map((item) => item.content), ["花生会让身体起疹子"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backfill embeds old rows and re-embeds them after a model switch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-mory-embedding-"));
  const backend = new MoryMemoryBackend({} as never, { dbPath: join(dir, "mory.sqlite"), dataDir: dir });
  const scope = { channel: "web", externalUserId: "web:momo:chat", botId: "momo", ownerId: "owner" };
  try {
    const first = await backend.add(scope, {
      content: "用户开特斯拉",
      domain: "owner",
      type: "user_fact",
      subject: "user.car",
      layer: "long_term"
    });
    const second = await backend.add(scope, {
      content: "用户养了一只叫豆豆的柯基",
      domain: "owner",
      type: "user_fact",
      subject: "pet.dog",
      layer: "long_term"
    });
    assert.ok(first.id);
    assert.ok(second.id);

    backend.configureEmbedder(async () => [0.1, 0.2, 0.3], "provider:model-a");
    const firstBackfill = await backend.backfillEmbeddings(1);
    assert.equal(firstBackfill.updatedCount, 1);
    assert.equal(firstBackfill.remainingCount, 1);

    const rest = await backend.backfillEmbeddings(10);
    assert.equal(rest.updatedCount, 1);
    assert.equal(rest.remainingCount, 0);

    // A different model version invalidates every row, even when it already has
    // a vector from the previous model.
    backend.configureEmbedder(async () => [0.4, 0.5, 0.6], "provider:model-b");
    const afterSwitch = await backend.backfillEmbeddings(10);
    assert.equal(afterSwitch.updatedCount, 2);
    assert.equal(afterSwitch.remainingCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

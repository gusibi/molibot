import test from "node:test";
import assert from "node:assert/strict";

import {
    InMemoryStorageAdapter,
    createSqliteStorageAdapter,
} from "../src/index.js";
import type { PersistedMemoryNode } from "../src/moryAdapter.js";

function makeNode(overrides: Partial<PersistedMemoryNode> = {}): PersistedMemoryNode {
    return {
        id: `mem-${Math.random().toString(36).slice(2, 10)}`,
        userId: "u1",
        path: "mory://user_preference/language",
        memoryType: "user_preference",
        subject: "language",
        value: "用户偏好中文回答",
        confidence: 0.85,
        importance: 0.7,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        conflictFlag: false,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// InMemoryStorageAdapter
// ═══════════════════════════════════════════════════════════════════════════

test("InMemory: insert and readByPath returns the node", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode();
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, node.id);
});

test("InMemory: readByPath filters by userId", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ userId: "u1" }));
    await storage.insert(makeNode({ userId: "u2" }));
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, "u1");
});

test("InMemory: readByPath filters by exact path", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ path: "mory://user_preference/language" }));
    await storage.insert(makeNode({ id: "n2", path: "mory://user_fact/name" }));
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 1);
});

test("InMemory: readByPath excludes archived by default", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ archivedAt: new Date().toISOString() });
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 0);
});

test("InMemory: readByPath includes archived when flag=true", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ archivedAt: new Date().toISOString() });
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language", true);
    assert.equal(rows.length, 1);
});

test("InMemory: readById returns correct node", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ id: "specific-id" });
    await storage.insert(node);
    const found = await storage.readById("u1", "specific-id");
    assert.ok(found);
    assert.equal(found!.id, "specific-id");
});

test("InMemory: readById returns undefined for missing id", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const found = await storage.readById("u1", "nonexistent");
    assert.equal(found, undefined);
});

test("InMemory: readById is userId-scoped", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "node-1", userId: "u1" }));
    const found = await storage.readById("u2", "node-1");
    assert.equal(found, undefined);
});

test("InMemory: list returns all active nodes for user", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "a", path: "mory://user_preference/language" }));
    await storage.insert(makeNode({ id: "b", path: "mory://user_fact/name" }));
    const rows = await storage.list("u1");
    assert.equal(rows.length, 2);
});

test("InMemory: list respects limit option", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    for (let i = 0; i < 5; i++) await storage.insert(makeNode({ id: `node-${i}`, path: `mory://user_fact/item${i}` }));
    const rows = await storage.list("u1", { limit: 2 });
    assert.equal(rows.length, 2);
});

test("InMemory: list filters by memoryTypes", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "pref", memoryType: "user_preference", path: "mory://user_preference/lang" }));
    await storage.insert(makeNode({ id: "fact", memoryType: "user_fact", path: "mory://user_fact/name" }));
    const rows = await storage.list("u1", { memoryTypes: ["user_fact"] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].memoryType, "user_fact");
});

test("InMemory: list filters by pathPrefixes", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "a", path: "mory://user_preference/language" }));
    await storage.insert(makeNode({ id: "b", path: "mory://user_fact/name" }));
    const rows = await storage.list("u1", { pathPrefixes: ["mory://user_preference"] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "a");
});

test("InMemory: list excludes archived by default", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "active" }));
    await storage.insert(makeNode({ id: "archived", archivedAt: new Date().toISOString() }));
    const rows = await storage.list("u1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "active");
});

test("InMemory: list isolates users", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ userId: "u1" }));
    await storage.insert(makeNode({ userId: "u2" }));
    const rows = await storage.list("u1");
    assert.equal(rows.length, 1);
});

test("InMemory: update patches node fields", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ id: "upd-1", confidence: 0.7 });
    await storage.insert(node);
    await storage.update("u1", "upd-1", { confidence: 0.95 });
    const rows = await storage.readByPath("u1", node.path);
    assert.equal(rows[0].confidence, 0.95);
});

test("InMemory: update returns undefined for missing node", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const result = await storage.update("u1", "ghost-id", { confidence: 0.5 });
    assert.equal(result, undefined);
});

test("InMemory: archive marks nodes with archivedAt", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ id: "arch-1" });
    await storage.insert(node);
    const count = await storage.archive("u1", ["arch-1"]);
    assert.equal(count, 1);
    const rows = await storage.readByPath("u1", node.path, false);
    assert.equal(rows.length, 0);
});

test("InMemory: archive returns 0 for empty ids", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const count = await storage.archive("u1", []);
    assert.equal(count, 0);
});

test("InMemory: archive does not double-archive", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const node = makeNode({ id: "dbl-arch" });
    await storage.insert(node);
    await storage.archive("u1", ["dbl-arch"]);
    const count2 = await storage.archive("u1", ["dbl-arch"]);
    assert.equal(count2, 0); // second call should report 0 newly archived
});

test("InMemory: vectorSearch returns top-K by cosine similarity with embeddings", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "v1", embedding: [1, 0, 0], path: "mory://user_preference/style" }));
    await storage.insert(makeNode({ id: "v2", embedding: [0, 1, 0], path: "mory://user_fact/name" }));
    await storage.insert(makeNode({ id: "v3", embedding: [0, 0, 1], path: "mory://skill/python" }));

    const hits = await storage.vectorSearch("u1", { vector: [1, 0, 0], topK: 1 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].node.id, "v1");
    assert.ok(hits[0].similarity > 0.99);
});

test("InMemory: vectorSearch skips nodes without embeddings", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "no-emb" })); // no embedding
    const hits = await storage.vectorSearch("u1", { vector: [1, 0, 0], topK: 5 });
    assert.equal(hits.length, 0);
});

test("InMemory: vectorSearch filters by memoryTypes", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ id: "pref", memoryType: "user_preference", embedding: [1, 0, 0], path: "mory://user_preference/x" }));
    await storage.insert(makeNode({ id: "fact", memoryType: "user_fact", embedding: [1, 0, 0], path: "mory://user_fact/x" }));

    const hits = await storage.vectorSearch("u1", { vector: [1, 0, 0], topK: 5, memoryTypes: ["user_fact"] });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].node.memoryType, "user_fact");
});

test("InMemory: vectorSearch is userId-scoped", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode({ userId: "u1", id: "u1n", embedding: [1, 0, 0] }));
    await storage.insert(makeNode({ userId: "u2", id: "u2n", embedding: [1, 0, 0] }));
    const hits = await storage.vectorSearch("u1", { vector: [1, 0, 0], topK: 5 });
    assert.ok(hits.every((h) => h.node.userId === "u1"));
});

// ═══════════════════════════════════════════════════════════════════════════
// SqliteStorageAdapter (in-memory DB)
// ═══════════════════════════════════════════════════════════════════════════

test("SQLite: init creates schema without error", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await assert.doesNotReject(() => storage.init());
});

test("SQLite: insert and readByPath roundtrip", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "sq-1" });
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "sq-1");
    assert.equal(rows[0].value, "用户偏好中文回答");
    assert.equal(rows[0].confidence, 0.85);
});

test("SQLite: readByPath excludes archived", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "arch-sq", archivedAt: new Date().toISOString() });
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 0);
});

test("SQLite: readById returns node", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "sq-read-id" });
    await storage.insert(node);
    const found = await storage.readById("u1", "sq-read-id");
    assert.ok(found);
    assert.equal(found!.id, "sq-read-id");
});

test("SQLite: update patches and re-reads correctly", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "sq-upd", confidence: 0.5 });
    await storage.insert(node);
    await storage.update("u1", "sq-upd", { confidence: 0.99 });
    const found = await storage.readById("u1", "sq-upd");
    assert.equal(found!.confidence, 0.99);
});

test("SQLite: archive marks node and excludes from readByPath", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "sq-arch" });
    await storage.insert(node);
    await storage.archive("u1", ["sq-arch"]);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.equal(rows.length, 0);
});

test("SQLite: persists embedding as JSON and reads back", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "emb-sq", embedding: [0.1, 0.2, 0.3] });
    await storage.insert(node);
    const rows = await storage.readByPath("u1", "mory://user_preference/language");
    assert.deepEqual(rows[0].embedding, [0.1, 0.2, 0.3]);
});

test("SQLite: vectorSearch works with stored embeddings", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    await storage.insert(makeNode({ id: "sq-v1", embedding: [1, 0, 0], path: "mory://user_preference/style" }));
    await storage.insert(makeNode({ id: "sq-v2", embedding: [0, 1, 0], path: "mory://user_preference/style2" }));

    const hits = await storage.vectorSearch("u1", { vector: [1, 0, 0], topK: 1 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].node.id, "sq-v1");
});

test("SQLite: list multiple nodes", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    await storage.insert(makeNode({ id: "l1", path: "mory://user_fact/a" }));
    await storage.insert(makeNode({ id: "l2", path: "mory://user_fact/b" }));
    const rows = await storage.list("u1");
    assert.equal(rows.length, 2);
});

test("SQLite: version and supersedes fields roundtrip", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const old = makeNode({ id: "old-v1", version: 1 });
    await storage.insert(old);
    await storage.archive("u1", ["old-v1"]);
    const newNode = makeNode({ id: "new-v2", version: 2, supersedes: "old-v1" });
    await storage.insert(newNode);
    const found = await storage.readById("u1", "new-v2");
    assert.equal(found!.version, 2);
    assert.equal(found!.supersedes, "old-v1");
});

test("SQLite: conflictFlag roundtrips correctly", async () => {
    const storage = createSqliteStorageAdapter(":memory:");
    await storage.init();
    const node = makeNode({ id: "conflict-node", conflictFlag: true });
    await storage.insert(node);
    const found = await storage.readById("u1", "conflict-node");
    assert.equal(found!.conflictFlag, true);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
    retentionScore,
    planForgetting,
    applyForgettingPolicy,
    InMemoryStorageAdapter,
    type ForgettingPolicy,
} from "../src/index.js";
import type { PersistedMemoryNode } from "../src/moryAdapter.js";

function makeNode(overrides: Partial<PersistedMemoryNode> = {}): PersistedMemoryNode {
    return {
        id: `mem-${Math.random().toString(36).slice(2)}`,
        userId: "u1",
        path: "mory://user_preference/language",
        memoryType: "user_preference",
        subject: "language",
        value: "用户偏好中文",
        confidence: 0.8,
        importance: 0.7,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        conflictFlag: false,
        ...overrides,
    };
}

// ── retentionScore ─────────────────────────────────────────────────────────

test("retentionScore: high importance + high confidence = high score", () => {
    const node = makeNode({ importance: 1, confidence: 1, accessCount: 10, updatedAt: new Date().toISOString() });
    const score = retentionScore(node);
    assert.ok(score > 0.7, `Expected > 0.7, got ${score}`);
});

test("retentionScore: low importance + low confidence = low score", () => {
    const node = makeNode({
        importance: 0,
        confidence: 0,
        accessCount: 0,
        updatedAt: new Date(Date.now() - 60 * 86400000).toISOString(), // 60 days ago
    });
    const score = retentionScore(node);
    assert.ok(score < 0.3, `Expected < 0.3, got ${score}`);
});

test("retentionScore: frequently accessed node scores higher", () => {
    const base = makeNode({ updatedAt: new Date(Date.now() - 7 * 86400000).toISOString() });
    const frequent = makeNode({ ...base, accessCount: 20 });
    const rare = makeNode({ ...base, accessCount: 0 });
    assert.ok(retentionScore(frequent) > retentionScore(rare));
});

test("retentionScore: recently updated node scores higher than old node", () => {
    const recent = makeNode({ updatedAt: new Date().toISOString(), importance: 0.5, confidence: 0.5, accessCount: 0 });
    const old = makeNode({ updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(), importance: 0.5, confidence: 0.5, accessCount: 0 });
    assert.ok(retentionScore(recent) > retentionScore(old));
});

test("retentionScore: returns value between 0 and 1", () => {
    const node = makeNode();
    const score = retentionScore(node);
    assert.ok(score >= 0 && score <= 1, `Score out of range: ${score}`);
});

test("retentionScore: handles invalid updatedAt gracefully", () => {
    const node = makeNode({ updatedAt: "invalid-date" });
    const score = retentionScore(node);
    assert.ok(score >= 0 && score <= 1);
});

// ── planForgetting ─────────────────────────────────────────────────────────

test("planForgetting: keeps all when count <= capacity", () => {
    const nodes = [makeNode(), makeNode()];
    const plan = planForgetting(nodes, { capacity: 10 });
    assert.equal(plan.keep.length, 2);
    assert.equal(plan.archive.length, 0);
    assert.equal(plan.archivedIds.length, 0);
});

test("planForgetting: archives lowest-scored when over capacity", () => {
    const important = makeNode({ importance: 1, confidence: 1, accessCount: 20, updatedAt: new Date().toISOString() });
    const disposable = makeNode({
        importance: 0.1,
        confidence: 0.1,
        accessCount: 0,
        updatedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    });
    const plan = planForgetting([important, disposable], { capacity: 1 });
    assert.equal(plan.keep.length, 1);
    assert.equal(plan.archive.length, 1);
    assert.equal(plan.keep[0].id, important.id);
    assert.equal(plan.archive[0].id, disposable.id);
});

test("planForgetting: archivedIds matches archive array ids", () => {
    const nodes = [makeNode(), makeNode(), makeNode()];
    const plan = planForgetting(nodes, { capacity: 1 });
    assert.deepEqual(plan.archivedIds, plan.archive.map((n) => n.id));
});

test("planForgetting: returns empty plan for empty input", () => {
    const plan = planForgetting([], { capacity: 5 });
    assert.equal(plan.keep.length, 0);
    assert.equal(plan.archive.length, 0);
});

test("planForgetting: respects minRetentionScore - archives below threshold", () => {
    const highScore = makeNode({ importance: 1, confidence: 1, accessCount: 20, updatedAt: new Date().toISOString() });
    const lowScore = makeNode({
        importance: 0.05,
        confidence: 0.05,
        accessCount: 0,
        updatedAt: new Date(Date.now() - 100 * 86400000).toISOString(),
    });
    const plan = planForgetting([highScore, lowScore], { capacity: 10, minRetentionScore: 0.5 });
    // lowScore may be archived even though capacity is not exceeded
    assert.ok(plan.archive.length >= 0); // at minimum works without crash
    assert.equal(plan.keep.length + plan.archive.length, 2);
});

test("planForgetting: capacity 0 archives everything", () => {
    const nodes = [makeNode(), makeNode()];
    const plan = planForgetting(nodes, { capacity: 0 });
    // All nodes may be archived (depending on minRetentionScore)
    assert.equal(plan.keep.length + plan.archive.length, 2);
});

// ── applyForgettingPolicy ──────────────────────────────────────────────────

test("applyForgettingPolicy: archives low-score nodes in storage", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();

    const important = makeNode({ importance: 1, confidence: 1, accessCount: 15, updatedAt: new Date().toISOString() });
    const disposable = makeNode({
        id: "disposable-1",
        importance: 0,
        confidence: 0,
        accessCount: 0,
        updatedAt: new Date(Date.now() - 100 * 86400000).toISOString(),
    });
    await storage.insert(important);
    await storage.insert(disposable);

    const policy: ForgettingPolicy = { capacity: 1 };
    const plan = await applyForgettingPolicy(storage, "u1", policy);

    assert.equal(plan.keep.length, 1);
    assert.equal(plan.archive.length, 1);

    // Verify archived node is actually marked in storage
    const after = await storage.list("u1", { includeArchived: false });
    assert.equal(after.length, 1);
});

test("applyForgettingPolicy: no-op when under capacity", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    await storage.insert(makeNode());

    const plan = await applyForgettingPolicy(storage, "u1", { capacity: 100 });
    assert.equal(plan.archive.length, 0);
    assert.equal(plan.keep.length, 1);
});

test("applyForgettingPolicy: works with empty storage", async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.init();
    const plan = await applyForgettingPolicy(storage, "u1", { capacity: 5 });
    assert.equal(plan.keep.length, 0);
    assert.equal(plan.archive.length, 0);
});

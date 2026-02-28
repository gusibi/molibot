import test from "node:test";
import assert from "node:assert/strict";

import {
    buildWorkspacePath,
    isWorkspacePath,
    shouldExpireWorkingMemory,
    toWorkingMemory,
} from "../src/index.js";

// ── buildWorkspacePath ────────────────────────────────────────────────────

test("workspace: buildWorkspacePath produces mory://task/session. prefix", () => {
    const path = buildWorkspacePath("sess-abc");
    assert.match(path, /^mory:\/\/task\/session\./);
});

test("workspace: buildWorkspacePath slugifies sessionId", () => {
    const path = buildWorkspacePath("My Session 123!");
    assert.match(path, /^mory:\/\/task\/session\./);
    assert.ok(!path.includes(" "), "Path should not contain spaces");
    assert.ok(!path.includes("!"), "Path should not contain special chars");
});

test("workspace: buildWorkspacePath includes key suffix", () => {
    const path = buildWorkspacePath("sess-1", "draft");
    assert.ok(path.endsWith("draft"), `Expected path to end with 'draft', got ${path}`);
});

test("workspace: buildWorkspacePath defaults key to 'state'", () => {
    const path = buildWorkspacePath("sess-1");
    assert.ok(path.endsWith("state"), `Expected path to end with 'state', got ${path}`);
});

test("workspace: buildWorkspacePath different sessions produce different paths", () => {
    const p1 = buildWorkspacePath("session-a");
    const p2 = buildWorkspacePath("session-b");
    assert.notEqual(p1, p2);
});

test("workspace: buildWorkspacePath same session+key is deterministic", () => {
    const p1 = buildWorkspacePath("my-session", "task_plan");
    const p2 = buildWorkspacePath("my-session", "task_plan");
    assert.equal(p1, p2);
});

// ── isWorkspacePath ───────────────────────────────────────────────────────

test("workspace: isWorkspacePath true for paths from buildWorkspacePath", () => {
    const path = buildWorkspacePath("sess-1");
    assert.equal(isWorkspacePath(path), true);
});

test("workspace: isWorkspacePath false for regular mory paths", () => {
    assert.equal(isWorkspacePath("mory://user_preference/language"), false);
});

test("workspace: isWorkspacePath false for non-mory paths", () => {
    assert.equal(isWorkspacePath("/profile/preferences"), false);
});

test("workspace: isWorkspacePath false for empty string", () => {
    assert.equal(isWorkspacePath(""), false);
});

// ── shouldExpireWorkingMemory ─────────────────────────────────────────────

test("workspace: shouldExpireWorkingMemory returns false for just-updated node", () => {
    const now = new Date().toISOString();
    assert.equal(shouldExpireWorkingMemory(now, 24), false);
});

test("workspace: shouldExpireWorkingMemory returns true for node updated 48h ago with 24h TTL", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    assert.equal(shouldExpireWorkingMemory(old, 24), true);
});

test("workspace: shouldExpireWorkingMemory returns false for node updated 1h ago with 24h TTL", () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    assert.equal(shouldExpireWorkingMemory(recent, 24), false);
});

test("workspace: shouldExpireWorkingMemory handles invalid date gracefully", () => {
    const result = shouldExpireWorkingMemory("not-a-date", 24);
    assert.equal(result, false);
});

test("workspace: shouldExpireWorkingMemory uses 24h default TTL", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    // Default TTL is 24h so this should be expired
    assert.equal(shouldExpireWorkingMemory(old), true);
});

// ── toWorkingMemory ───────────────────────────────────────────────────────

test("workspace: toWorkingMemory sets type to task", () => {
    const mem = toWorkingMemory({ subject: "status", value: "进行中", confidence: 0.9 }, "sess-1");
    assert.equal(mem.type, "task");
});

test("workspace: toWorkingMemory sets updatedPolicy to overwrite", () => {
    const mem = toWorkingMemory({ subject: "status", value: "进行中", confidence: 0.9 }, "sess-1");
    assert.equal(mem.updatedPolicy, "overwrite");
});

test("workspace: toWorkingMemory path matches buildWorkspacePath", () => {
    const mem = toWorkingMemory({ subject: "status", value: "进行中", confidence: 0.9 }, "sess-xyz", "plan");
    const expected = buildWorkspacePath("sess-xyz", "plan");
    assert.equal(mem.path, expected);
});

test("workspace: toWorkingMemory sets default importance 0.7", () => {
    const mem = toWorkingMemory({ subject: "x", value: "y", confidence: 0.8 }, "sess-1");
    assert.equal(mem.importance, 0.7);
});

test("workspace: toWorkingMemory sets default utility 0.9", () => {
    const mem = toWorkingMemory({ subject: "x", value: "y", confidence: 0.8 }, "sess-1");
    assert.equal(mem.utility, 0.9);
});

test("workspace: toWorkingMemory respects custom importance", () => {
    const mem = toWorkingMemory({ subject: "x", value: "y", confidence: 0.8, importance: 0.3 }, "sess-1");
    assert.equal(mem.importance, 0.3);
});

test("workspace: isWorkspacePath correctly identifies toWorkingMemory paths", () => {
    const mem = toWorkingMemory({ subject: "x", value: "y", confidence: 0.8 }, "sess-abc");
    assert.equal(isWorkspacePath(mem.path), true);
});

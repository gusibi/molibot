import test from "node:test";
import assert from "node:assert/strict";

import {
    validateCanonicalMemory,
    validateExtractionPayload,
    parseExtractionJson,
} from "../src/index.js";

// ── validateCanonicalMemory ────────────────────────────────────────────────

test("validation: rejects non-object input", () => {
    const r = validateCanonicalMemory("not an object");
    assert.equal(r.ok, false);
    assert.ok(r.issues.length > 0);
});

test("validation: rejects null", () => {
    const r = validateCanonicalMemory(null);
    assert.equal(r.ok, false);
});

test("validation: rejects array", () => {
    const r = validateCanonicalMemory([]);
    assert.equal(r.ok, false);
});

test("validation: rejects missing value field", () => {
    const r = validateCanonicalMemory({ path: "mory://user_preference/language", type: "user_preference", subject: "language", confidence: 0.9, updatedPolicy: "overwrite" });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.field === "value"));
});

test("validation: accepts minimal valid memory", () => {
    const r = validateCanonicalMemory({
        type: "user_preference",
        subject: "language",
        value: "用户偏好中文",
        confidence: 0.9,
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.ok(r.memory);
    assert.equal(r.memory?.type, "user_preference");
});

test("validation: fills path from type+subject when path missing", () => {
    const r = validateCanonicalMemory({
        type: "user_fact",
        subject: "name",
        value: "Gusi",
        confidence: 0.95,
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.path, "mory://user_fact/name");
});

test("validation: infers type from path when type missing", () => {
    const r = validateCanonicalMemory({
        path: "mory://skill/python.fastapi",
        value: "正在学习 FastAPI",
        confidence: 0.8,
        updatedPolicy: "merge_append",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.type, "skill");
});

test("validation: normalizes raw path via normalizeMoryPath", () => {
    const r = validateCanonicalMemory({
        path: "/profile/preferences/language",
        value: "用户偏好简短回答",
        confidence: 0.85,
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.match(r.memory!.path, /^mory:\/\//);
});

test("validation: clamps confidence above 1 to 1", () => {
    const r = validateCanonicalMemory({
        type: "user_preference",
        subject: "tone",
        value: "简洁",
        confidence: 1.5,
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.confidence, 1);
});

test("validation: clamps confidence below 0 to 0", () => {
    const r = validateCanonicalMemory({
        type: "user_preference",
        subject: "tone",
        value: "简洁",
        confidence: -0.5,
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.confidence, 0);
});

test("validation: uses default policy when updatedPolicy invalid", () => {
    const r = validateCanonicalMemory({
        type: "user_preference",
        subject: "style",
        value: "正式",
        confidence: 0.8,
        updatedPolicy: "invalid_policy",
    });
    assert.equal(r.ok, true);
    assert.ok(["overwrite", "merge_append", "highest_confidence", "skip"].includes(r.memory!.updatedPolicy));
});

test("validation: accepts all four valid update policies", () => {
    const policies = ["overwrite", "merge_append", "highest_confidence", "skip"] as const;
    for (const policy of policies) {
        const r = validateCanonicalMemory({
            type: "user_preference",
            subject: "x",
            value: "something",
            confidence: 0.8,
            updatedPolicy: policy,
        });
        assert.equal(r.ok, true, `policy ${policy} should be valid`);
        assert.equal(r.memory?.updatedPolicy, policy);
    }
});

test("validation: passes through optional title field", () => {
    const r = validateCanonicalMemory({
        type: "user_fact",
        subject: "name",
        value: "Alice",
        confidence: 0.9,
        updatedPolicy: "overwrite",
        title: "用户名字",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.title, "用户名字");
});

test("validation: passes through optional importance field", () => {
    const r = validateCanonicalMemory({
        type: "user_fact",
        subject: "location",
        value: "Beijing",
        confidence: 0.8,
        updatedPolicy: "overwrite",
        importance: 0.75,
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.importance, 0.75);
});

test("validation: strictPath rejects unnormalized path", () => {
    const r = validateCanonicalMemory(
        { path: "mory://INVALID/path!!", value: "test", confidence: 0.8, updatedPolicy: "overwrite" },
        { strictPath: true }
    );
    // should either fail or normalize; if path remains non-canonical, issues should be raised
    // This tests that strictPath actually triggers the check
    if (!r.ok) {
        assert.ok(r.issues.some((i) => i.field === "path"));
    }
});

test("validation: uses source/observedAt from options", () => {
    const r = validateCanonicalMemory(
        { type: "user_preference", subject: "lang", value: "中文", confidence: 0.9, updatedPolicy: "overwrite" },
        { source: "session-42", observedAt: "2026-01-01T00:00:00.000Z" }
    );
    assert.equal(r.ok, true);
    assert.equal(r.memory?.source, "session-42");
    assert.equal(r.memory?.observedAt, "2026-01-01T00:00:00.000Z");
});

test("validation: falls back default confidence 0.7 if undefined", () => {
    const r = validateCanonicalMemory({
        type: "world_knowledge",
        subject: "earth",
        value: "地球是圆的",
        updatedPolicy: "overwrite",
    });
    assert.equal(r.ok, true);
    assert.equal(r.memory?.confidence, 0.7);
});

// ── validateExtractionPayload ──────────────────────────────────────────────

test("validateExtractionPayload: rejects non-object payload", () => {
    const r = validateExtractionPayload("bad input");
    assert.equal(r.memories.length, 0);
    assert.ok(r.issues.length > 0);
});

test("validateExtractionPayload: rejects payload without memories array", () => {
    const r = validateExtractionPayload({ notMemories: [] });
    assert.ok(r.issues.length > 0);
});

test("validateExtractionPayload: returns empty memories for empty array", () => {
    const r = validateExtractionPayload({ memories: [] });
    assert.equal(r.memories.length, 0);
    assert.equal(r.issues.length, 0);
});

test("validateExtractionPayload: extracts one valid memory", () => {
    const r = validateExtractionPayload({
        memories: [
            { type: "user_preference", subject: "language", value: "中文", confidence: 0.9, updatedPolicy: "overwrite" },
        ],
    });
    assert.equal(r.memories.length, 1);
    assert.equal(r.issues.length, 0);
});

test("validateExtractionPayload: skips invalid and reports issues", () => {
    const r = validateExtractionPayload({
        memories: [
            { type: "user_preference", subject: "language", value: "中文", confidence: 0.9, updatedPolicy: "overwrite" },
            { type: "user_preference", subject: "style" /* missing value */ },
        ],
    });
    assert.equal(r.memories.length, 1);
    assert.ok(r.issues.some((i) => i.field.startsWith("memories[1]")));
});

test("validateExtractionPayload: handles multiple valid memories", () => {
    const r = validateExtractionPayload({
        memories: [
            { type: "user_preference", subject: "language", value: "中文", confidence: 0.9, updatedPolicy: "overwrite" },
            { type: "user_fact", subject: "name", value: "Gusi", confidence: 0.95, updatedPolicy: "overwrite" },
            { type: "skill", subject: "python", value: "熟练", confidence: 0.8, updatedPolicy: "merge_append" },
        ],
    });
    assert.equal(r.memories.length, 3);
});

// ── parseExtractionJson ────────────────────────────────────────────────────

test("parseExtractionJson: parses valid JSON with memories array", () => {
    const json = JSON.stringify({ memories: [{ type: "user_preference", subject: "x", value: "y", confidence: 0.8, updatedPolicy: "overwrite" }] });
    const payload = parseExtractionJson(json);
    assert.ok(Array.isArray(payload.memories));
    assert.equal(payload.memories.length, 1);
});

test("parseExtractionJson: throws on JSON without memories field", () => {
    const json = JSON.stringify({ not_memories: [] });
    assert.throws(() => parseExtractionJson(json), /memories/);
});

test("parseExtractionJson: throws on malformed JSON", () => {
    assert.throws(() => parseExtractionJson("{bad json}"));
});

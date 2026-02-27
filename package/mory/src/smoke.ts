import { normalizeMoryPath } from "./moryPath.js";
import { decideWrite, jaccardSimilarity, explainDecision } from "./moryWriteGate.js";

// ── Path normalization ──────────────────────────────────────────────────────
const pathCases: [string, string][] = [
    ["/profile/preferences/language", "mory://user_preference/language"],
    ["mory://user/lang_pref", "mory://user_preference/language"],
    ["mory://skill/python/fastapi", "mory://skill/python.fastapi"],
    ["mory://profile/name", "mory://user_fact/name"],
    ["/workspace/project_a", "mory://task/project_a"],
    ["preferences/code_style", "mory://user_preference/code_style"],
    ["mory://user_preference/answer_length", "mory://user_preference/answer_length"],
];

console.log("=== Path normalization ===");
let pathPass = 0, pathFail = 0;
for (const [input, expected] of pathCases) {
    const result = normalizeMoryPath(input);
    const ok = result === expected;
    ok ? pathPass++ : pathFail++;
    console.log(`  ${ok ? "✅" : "❌"} "${input}"`);
    if (!ok) console.log(`       expected: ${expected}\n       got:      ${result}`);
}
console.log(`  → ${pathPass}/${pathCases.length} passed\n`);

// ── Jaccard ─────────────────────────────────────────────────────────────────
console.log("=== Jaccard similarity ===");
const j1 = jaccardSimilarity("用户偏好简短回答", "用户偏好简短回答");
console.log(`  identical:        ${j1.toFixed(2)} (expected 1.00) ${j1 === 1 ? "✅" : "❌"}`);
const j2 = jaccardSimilarity("用户偏好简短回答", "用户偏好详细的回答");
console.log(`  diff value:       ${j2.toFixed(2)} (expected < 0.8) ${j2 < 0.8 ? "✅" : "❌"}`);
const j3 = jaccardSimilarity("short answers", "completely unrelated");
console.log(`  disjoint:         ${j3.toFixed(2)} (expected 0.00) ${j3 === 0 ? "✅" : "❌"}`);

// ── Write gate ───────────────────────────────────────────────────────────────
console.log("\n=== Write gate decisions ===");

const base = {
    path: "mory://user_preference/answer_length",
    type: "user_preference" as const,
    subject: "answer_length",
    value: "用户明确表示更喜欢简短的回答风格",
    confidence: 0.9,
    updatedPolicy: "overwrite" as const,
};
const existingNode = {
    id: "existing-1",
    moryPath: base.path,
    value: base.value,
    confidence: 0.9,
    updatedAt: new Date().toISOString(),
};

const d1 = decideWrite([], base);
const ok1 = d1.action === "insert";
console.log(`  ${ok1 ? "✅" : "❌"} [empty existing] → ${explainDecision(d1)}`);

const d2 = decideWrite([existingNode], base);
const ok2 = d2.action === "skip";
console.log(`  ${ok2 ? "✅" : "❌"} [exact dupe] → ${explainDecision(d2)}`);

const different = { ...base, value: "用户现在偏好详细的回答风格", confidence: 0.95 };
const d3 = decideWrite([existingNode], different);
const ok3 = d3.action === "update";
console.log(`  ${ok3 ? "✅" : "❌"} [new value, overwrite] → ${explainDecision(d3)}`);

const lowConf = { ...base, updatedPolicy: "highest_confidence" as const, confidence: 0.5 };
const d4 = decideWrite([existingNode], lowConf);
const ok4 = d4.action === "skip";
console.log(`  ${ok4 ? "✅" : "❌"} [lower confidence, highest_confidence policy] → ${explainDecision(d4)}`);

const highConf = { ...base, updatedPolicy: "highest_confidence" as const, confidence: 0.99, value: "用户偏好超级简短回答" };
const d5 = decideWrite([existingNode], highConf);
const ok5 = d5.action === "update";
console.log(`  ${ok5 ? "✅" : "❌"} [higher confidence, highest_confidence policy] → ${explainDecision(d5)}`);

const appendMem = { ...base, updatedPolicy: "merge_append" as const, value: "用户更喜欢简洁的回答" };
const d6 = decideWrite([existingNode], appendMem);
const ok6 = d6.action === "update";
console.log(`  ${ok6 ? "✅" : "❌"} [similar, merge_append] → ${explainDecision(d6)}`);

// summary
const total = [ok1, ok2, ok3, ok4, ok5, ok6].filter(Boolean).length;
console.log(`  → ${total}/6 passed`);
console.log(`\n=== smoke test complete: path ${pathPass}/${pathCases.length}, gate ${total}/6 ===`);

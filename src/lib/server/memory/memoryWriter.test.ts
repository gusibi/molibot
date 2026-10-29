import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveMemory, MemoryWriter, normalizeSubject } from "./memoryWriter.js";
import type { MemoryAddInput, MemoryCandidateCreateInput, MemoryScope } from "./types.js";

const scope: MemoryScope = {
  channel: "web",
  externalUserId: "web:default:chat",
  botId: "default",
  agentId: "default",
  ownerId: "owner"
};
const sources = [{ channel: "web", sessionId: "session-1", conversationMessageId: "message-1" }];

function harness(options: { failAdd?: boolean; suppressedSubject?: string } = {}) {
  const added: MemoryAddInput[] = [];
  const candidates: MemoryCandidateCreateInput[] = [];
  const writer = new MemoryWriter({
    add: async (_scope, input) => {
      if (options.failAdd) throw new Error("write rejected");
      added.push(input);
      return { id: `memory-${added.length}` } as never;
    },
    createScopedCandidate: (_scope, input) => {
      candidates.push(input);
      return { id: `candidate-${candidates.length}` } as never;
    },
    isPrivacySuppressed: (input) => Boolean(options.suppressedSubject)
      && input.subject === options.suppressedSubject
  });
  return { writer, added, candidates };
}

test("a non-sensitive fact commits directly with its subject", async () => {
  const h = harness();
  const result = await h.writer.write(scope, [{
    domain: "owner",
    type: "user_fact",
    subject: "pet.dog",
    value: "养了一只叫豆豆的柯基",
    confidence: 0.9
  }], sources, "extract:session-1:m1");

  assert.deepEqual(result.committed, ["memory-1"]);
  assert.deepEqual(result.proposals, []);
  assert.equal(h.added.length, 1);
  assert.equal(h.added[0].subject, "pet.dog");
  assert.equal(h.added[0].namespace, "owner:owner");
  assert.equal(h.candidates.length, 0);
});

test("health facts become proposals instead of active records", async () => {
  const h = harness();
  const result = await h.writer.write(scope, [{
    domain: "owner",
    type: "user_fact",
    subject: "health.allergy",
    value: "我对花生严重过敏，吃一点就会起疹子",
    confidence: 0.95
  }], sources, "extract:session-1:m1");

  assert.deepEqual(result.committed, []);
  assert.deepEqual(result.proposals, ["candidate-1"]);
  assert.equal(h.added.length, 0);
  assert.equal(h.candidates[0].value, "我对花生严重过敏，吃一点就会起疹子");
});

test("the extractor can mark a fact sensitive even when the vocabulary does not", () => {
  assert.equal(isSensitiveMemory({ subject: "user.plan", value: "准备搬去另一个城市", sensitivity: "sensitive" }), true);
  assert.equal(isSensitiveMemory({ subject: "user.drink", value: "喜欢不加糖的美式", sensitivity: "normal" }), false);
});

test("a short but complete structured fact is not treated as noise", async () => {
  const h = harness();
  const result = await h.writer.write(scope, [{
    domain: "owner",
    type: "user_preference",
    subject: "user.diet",
    value: "不吃辣"
  }], sources, "extract:session-1:m1");

  assert.deepEqual(result.committed, ["memory-1"]);
  assert.equal(h.added[0].content, "不吃辣");
});

test("a project fact from a non-project session is skipped, not retried forever", async () => {
  const h = harness();
  const result = await h.writer.write(scope, [{
    domain: "project",
    type: "user_fact",
    subject: "project.deadline",
    value: "项目计划在下个月发布第一版"
  }], sources, "extract:session-1:m1");

  assert.equal(result.skipped, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(h.added.length, 0);
});

test("an Agent that does not share owner memory keeps the fact in its chat", async () => {
  const h = harness();
  const result = await h.writer.write({ ...scope, shareOwner: false }, [{
    domain: "owner",
    type: "user_fact",
    subject: "pet.dog",
    value: "养了一只叫豆豆的柯基"
  }], sources, "extract:session-1:m1");

  assert.deepEqual(result.committed, ["memory-1"]);
  assert.ok(String(h.added[0].namespace).startsWith("chat:"));
});

test("a forgotten subject is suppressed rather than re-created", async () => {
  const h = harness({ suppressedSubject: "pet.dog" });
  const result = await h.writer.write(scope, [{
    domain: "owner",
    type: "user_fact",
    subject: "pet.dog",
    value: "养了一只叫豆豆的柯基"
  }], sources, "extract:session-1:m1");

  assert.equal(result.skipped, 1);
  assert.deepEqual(result.committed, []);
  assert.deepEqual(result.proposals, []);
  assert.equal(h.added.length, 0);
});

test("a rejected write is reported without aborting sibling items", async () => {
  const h = harness({ failAdd: true });
  const result = await h.writer.write(scope, [{
    domain: "owner",
    type: "user_fact",
    subject: "pet.dog",
    value: "养了一只叫豆豆的柯基"
  }], sources, "extract:session-1:m1");

  assert.deepEqual(result.committed, []);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /write rejected/);
});

test("subjects are normalized so later corrections target the same slot", () => {
  assert.equal(normalizeSubject("  User.Employer!! "), "user.employer");
  assert.equal(normalizeSubject("用户.宠物"), "用户.宠物");
  assert.equal(normalizeSubject("user.car.previous"), "user.car");
  assert.equal(normalizeSubject("user.car.current"), "user.car");
  assert.equal(normalizeSubject("user.car_previous"), "user.car");
  assert.equal(normalizeSubject("user.employer.之前"), "user.employer");
  assert.equal(normalizeSubject(""), "");
});

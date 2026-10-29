import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryTools } from "./memory.js";

const scope = { channel: "web", externalUserId: "web:personal:eval", botId: "personal", ownerId: "owner" } as any;

const memoryRecord = {
  id: "mem-1",
  channel: "web",
  externalUserId: "web:personal:eval",
  content: "不喝咖啡",
  tags: [],
  layer: "long_term",
  namespace: "owner:owner",
  domain: "owner",
  type: "user_fact",
  subject: "user.drink",
  state: "active",
  version: 1,
  accessCount: 0,
  injectionCount: 0,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z"
};

function toolsWith(overrides: Record<string, any> = {}, writesAllowed = true, toolScope: any = scope) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const memory = new Proxy(
    {
      add: async (..._args: any[]) => memoryRecord,
      createScopedCandidate: (..._args: any[]) => ({ id: "candidate-1" }),
      isPrivacySuppressed: () => false,
      getForGovernance: async () => memoryRecord,
      search: async (..._args: any[]) => [memoryRecord],
      delete: async (..._args: any[]) => true,
      forget: async (..._args: any[]) => true,
      ...overrides
    } as any,
    {
      get(target, prop: string) {
        const value = target[prop];
        if (typeof value !== "function") return value;
        // The writer calls these synchronously; wrapping them in async would
        // make every call look suppressed.
        if (prop === "isPrivacySuppressed" || prop === "createScopedCandidate") {
          return (...args: any[]) => {
            calls.push({ method: prop, args });
            return value(...args);
          };
        }
        return async (...args: any[]) => {
          calls.push({ method: prop, args });
          return value(...args);
        };
      }
    }
  );
  const tools = createMemoryTools({ memory, scope: toolScope, writesAllowed });
  const byName = (name: string) => tools.find((tool) => tool.name === name)!;
  return { tools, byName, calls };
}

test("save_memory writes a structured user fact through the shared writer", async () => {
  const { byName, calls } = toolsWith();
  const result = await byName("save_memory").execute("call-1", { fact: "我不喝咖啡" } as any, undefined as any);
  const written = calls.find((call) => call.method === "add");
  assert.ok(written);
  assert.equal(written!.args[1].content, "我不喝咖啡");
  assert.equal(written!.args[1].domain, "owner");
  assert.equal(written!.args[1].type, "user_fact");
  assert.equal(typeof written!.args[1].subject, "string");
  assert.match(String((result.content[0] as any).text), /Saved memory mem-1/);
});

test("save_memory reuses an explicit subject so a correction targets the same fact", async () => {
  const { byName, calls } = toolsWith();
  await byName("save_memory").execute("call-2", { fact: "我现在开特斯拉", subject: "user.car" } as any, undefined as any);
  const written = calls.find((call) => call.method === "add");
  assert.equal(written!.args[1].subject, "user.car");
});

test("two different facts without an explicit subject do not collapse into one slot", async () => {
  const { byName, calls } = toolsWith();
  await byName("save_memory").execute("call-a", { fact: "我喜欢喝咖啡" } as any, undefined as any);
  await byName("save_memory").execute("call-b", { fact: "我喜欢喝茶" } as any, undefined as any);
  const subjects = calls.filter((call) => call.method === "add").map((call) => call.args[1].subject);
  assert.equal(subjects.length, 2);
  assert.notEqual(subjects[0], subjects[1]);
});

test("sensitive facts are saved as proposals, not active records", async () => {
  const { byName, calls } = toolsWith();
  const result = await byName("save_memory").execute(
    "call-3",
    { fact: "我对花生严重过敏，吃一点就会起疹子" } as any,
    undefined as any
  );
  assert.equal(calls.some((call) => call.method === "add"), false);
  assert.equal(calls.some((call) => call.method === "createScopedCandidate"), true);
  assert.match(String((result.content[0] as any).text), /pending proposal/);
  assert.equal((result as any).isError, undefined);
});

test("save_memory rejects a project fact outside a project session", async () => {
  const { byName, calls } = toolsWith();
  const result = await byName("save_memory").execute(
    "call-4",
    { fact: "项目计划下个月发布", about: "project" } as any,
    undefined as any
  );
  assert.equal((result as any).isError, true);
  assert.match(String((result.content[0] as any).text), /project session/);
  assert.deepEqual(calls, []);
});

test("save_memory writes Agent self-knowledge when an Agent identity exists", async () => {
  const agentScope = { ...scope, agentId: "researcher" };
  const { byName, calls } = toolsWith({}, true, agentScope);
  await byName("save_memory").execute(
    "call-5",
    { fact: "我的职责是研究资料并给出证据", about: "agent" } as any,
    undefined as any
  );
  const written = calls.find((call) => call.method === "add");
  assert.equal(written!.args[1].domain, "agent_self");
  assert.equal(written!.args[1].namespace, "agent:researcher");
});

test("recall_memory returns ids and subjects, and works on a no-memory turn", async () => {
  const { byName, calls } = toolsWith({}, false);
  const result = await byName("recall_memory").execute("call-6", { query: "喝什么" } as any, undefined as any);
  const text = String((result.content[0] as any).text);
  assert.match(text, /id=mem-1/);
  assert.match(text, /subject=user\.drink/);
  assert.equal(calls[0].method, "search");
});

test("forget_memory deletes by id even on a no-memory turn", async () => {
  const allowed = toolsWith();
  const result = await allowed.byName("forget_memory").execute("call-7", { id: "mem-1" } as any, undefined as any);
  assert.match(String((result.content[0] as any).text), /Forgotten memory mem-1/);

  // A no-memory turn must still honor an explicit deletion request; it only
  // forbids remembering new content.
  const noMemoryTurn = toolsWith({}, false);
  const deleted = await noMemoryTurn.byName("forget_memory").execute("call-8", { id: "mem-1" } as any, undefined as any);
  assert.equal((deleted as any).isError, undefined);
  assert.deepEqual(noMemoryTurn.calls.map((call) => call.method), ["forget"]);
});

test("save_memory is blocked on a no-memory turn", async () => {
  const { byName, calls } = toolsWith({}, false);
  const result = await byName("save_memory").execute("call-9", { fact: "TMP-4821" } as any, undefined as any);
  assert.equal((result as any).isError, true);
  assert.match(String((result.content[0] as any).text), /not eligible for memory writes/);
  assert.deepEqual(calls, []);
});

test("maintenance and the published-content corpus are not model-facing tools", () => {
  const { tools } = toolsWith();
  assert.deepEqual(tools.map((tool) => tool.name), ["save_memory", "recall_memory", "forget_memory"]);
  for (const tool of tools) {
    assert.equal("action" in (tool.parameters as any).properties, false);
  }
});

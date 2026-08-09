import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryTool } from "./memory.js";

const scope = { channel: "web", externalUserId: "web:personal:eval", botId: "personal" } as any;

function toolWith(overrides: Record<string, any> = {}, writesAllowed = true) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const memory = new Proxy(
    {
      add: async (..._args: any[]) => ({ id: "mem-1" }),
      addContentMemory: async (..._args: any[]) => ({ id: "mem-content-1" }),
      setAgentSelfMemory: async (..._args: any[]) => ({ id: "mem-self-1" }),
      ...overrides
    } as any,
    {
      get(target, prop: string) {
        const value = target[prop];
        if (typeof value !== "function") return value;
        return async (...args: any[]) => {
          calls.push({ method: prop, args });
          return value(...args);
        };
      }
    }
  );
  return { tool: createMemoryTool({ memory, scope, writesAllowed }), calls };
}

/**
 * The §3.49 misroute, from the model's side.
 *
 * `content:<botId>` is deliberately outside `promptMemoryNamespaces`, so it is
 * write-only with respect to conversation. `add_content` nevertheless *defaulted*
 * to `user_fact` — the one record type that must never go there — and its name
 * reads like "add this content", so a model asked to remember something picked
 * it, got "Saved …", and the fact was unreachable from the next session.
 */
test("add_content refuses a user fact and names the action that works", async () => {
  const { tool, calls } = toolWith();
  await assert.rejects(
    () => tool.execute("call-1", { action: "add_content", content: "用 Obsidian", subject: "笔记工具", type: "user_fact" } as any, undefined as any),
    /action="add"/
  );
  await assert.rejects(
    () => tool.execute("call-2", { action: "add_content", content: "喜欢简洁", subject: "风格", type: "user_preference" } as any, undefined as any),
    /never recalled in conversation/
  );
  assert.deepEqual(calls.filter((call) => call.method === "addContentMemory"), [], "nothing may be written before the check");
});

test("add_content requires an explicit published-content type", async () => {
  const { tool, calls } = toolWith();
  await assert.rejects(
    () => tool.execute("call-3", { action: "add_content", content: "我使用 Obsidian", subject: "笔记工具" } as any, undefined as any),
    /explicit published-content type/
  );
  assert.deepEqual(calls.filter((call) => call.method === "addContentMemory"), []);
});

test("add_content accepts only published reference knowledge", async () => {
  const { tool, calls } = toolWith();
  await tool.execute("call-published", {
    action: "add_content",
    content: "一篇已发布文章的开头",
    subject: "文章-2026-08",
    type: "world_knowledge"
  } as any, undefined as any);
  const written = calls.find((call) => call.method === "addContentMemory");
  assert.equal(written?.args[1].type, "world_knowledge");
});

test("remembering something about the user goes through add, untouched", async () => {
  const { tool, calls } = toolWith();
  const result = await tool.execute("call-4", { action: "add", content: "不喝咖啡" } as any, undefined as any);
  const written = calls.find((call) => call.method === "add");
  assert.notEqual(written, undefined);
  assert.equal(written!.args[1].content, "不喝咖啡");
  assert.match(String(result.content?.[0]?.text ?? ""), /Added memory/);
});

test("a no-memory turn blocks writes but still permits search and deletion", async () => {
  const { tool, calls } = toolWith({
    search: async () => [],
    delete: async () => true
  }, false);
  await assert.rejects(
    () => tool.execute("call-private-add", { action: "add", content: "TMP-4821" } as any, undefined as any),
    /not eligible for memory writes/
  );
  await tool.execute("call-private-search", { action: "search", query: "旧偏好" } as any, undefined as any);
  await tool.execute("call-private-delete", { action: "delete", id: "mem-old" } as any, undefined as any);
  assert.deepEqual(calls.map((call) => call.method), ["search", "delete"]);
});

/**
 * The description is the only thing standing between a model and the write-only
 * corpus, so it has to say both halves out loud.
 */
test("the tool description steers remembering to add and warns about the corpus", () => {
  const { tool } = toolWith();
  assert.match(tool.description, /action=add/);
  // Collapsed first: the warning wraps across lines in the rendered text, and a
  // regex that silently depends on where it wraps is not a guard.
  const collapsed = tool.description.replace(/\s+/g, " ");
  assert.match(collapsed, /NEVER recalled in conversation/);
  assert.match(collapsed, /requires type=world_knowledge/);
  assert.match(collapsed, /use add for every user fact or preference/);
});

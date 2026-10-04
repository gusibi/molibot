import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodemodeTool } from "./codemode.js";

const query: AgentTool<any> = { name: "query", label: "Query", description: "List items", parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: "text", text: "items" }], details: { items: [1, 2, 3] } }) };

async function fixture(run: (tool: AgentTool<any>, dir: string, ids: string[]) => Promise<void>, tools = [query]) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-codemode-"));
  const ids: string[] = [];
  try {
    const tool = createCodemodeTool({ getTools: () => tools, artifactDir: join(dir, "artifacts"), workspaceDir: dir,
      invoke: async (selected, id, args, signal) => { ids.push(id); return { result: await selected.execute(id, args, signal), isError: false }; } });
    await run(tool, dir, ids);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Pi Codemode batches queries, filters results and discovers only injected tools", () => fixture(async (tool, _dir, ids) => {
  const result = await tool.execute("batch", { code: 'const values = await Promise.all([tools.query({}), tools.query({})]); text(values.flatMap(x=>x.details.items).filter(x=>x>2)); text(ALL_TOOLS); text(await describeTool("query")); text(await searchTools("List"));' });
  assert.match(result.content[0].type === "text" ? result.content[0].text : "", /\[3,3\]/);
  assert.deepEqual(ids, ["batch:codemode:1", "batch:codemode:2"]);
  assert.equal((result as any).error, undefined);
}));

test("Pi VM has no direct host capabilities or nested Codemode", () => fixture(async tool => {
  const result = await tool.execute("scope", { code: 'text([typeof process, typeof require, typeof fetch, typeof models]);' });
  assert.match((result.content[0] as any).text, /\["undefined","undefined","undefined","undefined"\]/);
  const nested = await tool.execute("nested", { code: "await tools.codemode({code: \"return 1\"});" });
  assert.match((nested as any).error, /codemode does not exist/);
}));

test("script failure preserves prior results and operation ids", () => fixture(async (tool, _dir, ids) => {
  const result = await tool.execute("partial", { code: 'text(await tools.query({})); throw new Error("failed after operation");' });
  assert.match((result.content[0] as any).text, /items/);
  assert.match((result as any).error, /failed after operation/);
  assert.deepEqual(ids, ["partial:codemode:1"]);
  assert.equal((result.details as any).requiresReplan, true);
}));

test("approval suspension ends scripts even if they try to catch and continue", () => fixture(async (tool, _dir, ids) => {
  const result = await tool.execute("approval", { code: 'text("before approval"); try { await tools.query({}); } catch {} await tools.query({});' });
  assert.equal((result as any).terminate, true);
  assert.equal((result.details as any).approvalRequestId, "approval-1");
  assert.deepEqual(ids, ["approval:codemode:1"]);
  assert.match((result.content[0] as any).text, /before approval/);
}, [{ ...query, execute: async () => ({ content: [{ type: "text", text: "Waiting" }], details: { approvalRequestId: "approval-1" }, terminate: true } as any) }]));

test("infinite loop is isolated and bounded", () => fixture(async tool => {
  const start = Date.now();
  const result = await tool.execute("loop", { code: '// @options: {"timeout_ms":100}\nwhile(true) {}' });
  assert.equal((result.details as any).errorKind, "timeout");
  assert.ok(Date.now() - start < 5_000);
}));

test("cancelled unawaited operations settle before Codemode returns", () => fixture(async tool => {
  const result = await tool.execute("unawaited", { code: 'tools.query({}); return "done";' });
  assert.match((result.content[0] as any).text, /done/);
}, [{ ...query, execute: async (_id, _args, signal) => {
  await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => setTimeout(resolve, 20), { once: true }); });
  return { content: [], details: {} };
} }]));

test("large output is bounded and full output is a readable artifact", () => fixture(async (tool, dir) => {
  const result = await tool.execute("large", { code: '// @options: {"max_output_tokens":10}\ntext("x".repeat(1000));' });
  assert.match((result.content[0] as any).text, /Output truncated/);
  assert.equal(readFileSync(join(dir, (result.details as any).outputRef), "utf8"), "x".repeat(1000));
}));

test("stop cancels the process and its pending tool before returning", () => fixture(async tool => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    const result = await tool.execute("stop", { code: 'text("before cancellation"); await tools.query({});' }, controller.signal);
    assert.equal((result.details as any).errorKind, "aborted");
    assert.match((result.content[0] as any).text, /before cancellation/);
  } finally { clearTimeout(timer); }
}, [{ ...query, execute: async (_id, _args, signal) => {
  await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
  return { content: [], details: {} };
} }]));


test("VM memory exhaustion cannot take down the host process", () => fixture(async tool => {
  const result = await tool.execute("memory", { code: '// @options: {"timeout_ms":2000}\nconst values = []; while(true) values.push("x".repeat(1000000));' });
  assert.ok((result as any).error);
  const next = await tool.execute("after-memory", { code: 'return 42;' });
  assert.match((next.content[0] as any).text, /42/);
}));

test("same query task keeps two backend calls but reduces returned model input", async () => {
  const items = Array.from({ length: 100 }, (_, id) => ({ id, note: "x".repeat(100), selected: id === 99 }));
  const largeQuery = { ...query, execute: async () => ({ content: [{ type: "text" as const, text: JSON.stringify(items) }], details: { items } }) };
  const direct = await Promise.all([largeQuery.execute(), largeQuery.execute()]);
  const directChars = direct.reduce((sum, result) => sum + result.content[0].text.length, 0);
  await fixture(async (tool, _dir, ids) => {
    const result = await tool.execute("measurement", { code: 'const results = await Promise.all([tools.query({}),tools.query({})]); text(results.flatMap(x=>x.details.items).filter(x=>x.selected).map(x=>x.id));' });
    const codeChars = (result.content[0] as any).text.length;
    assert.deepEqual(ids, ["measurement:codemode:1", "measurement:codemode:2"]);
    assert.ok(codeChars < directChars / 100);
    assert.equal(codeChars, 7);
    assert.equal((result.content[0] as any).text, "[99,99]");
  }, [largeQuery]);
});

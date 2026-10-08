import assert from "node:assert/strict";
import test from "node:test";
import { formatReuseNotice, markReusedResult, ResultReuseCache } from "$lib/server/agent/tools/resultReuse.js";
import type { ToolResult } from "$lib/server/agent/tools/toolTypes.js";

function textResult(text: string): ToolResult {
  return { ok: true, content: [{ type: "text", text }] };
}

test("reuse cache returns a recorded result only while its version matches", () => {
  const cache = new ResultReuseCache();
  assert.equal(cache.get("read|a.txt|o=0|l=0", "v1"), undefined);

  cache.set("read|a.txt|o=0|l=0", "v1", ["a.txt"], textResult("hello"));
  const hit = cache.get("read|a.txt|o=0|l=0", "v1");
  assert.equal((hit?.content as any)[0].text, "hello");

  // A changed source version must not serve stale content.
  assert.equal(cache.get("read|a.txt|o=0|l=0", "v2"), undefined);
  assert.equal(cache.size, 0, "a stale lookup evicts its entry");
});

test("a different range is a different reuse key", () => {
  const cache = new ResultReuseCache();
  cache.set("read|a.txt|o=1|l=10", "v1", ["a.txt"], textResult("range-1"));
  assert.equal(cache.get("read|a.txt|o=11|l=10", "v1"), undefined);
});

test("invalidating a written source drops only the reads that depend on it", () => {
  const cache = new ResultReuseCache();
  cache.set("read|a.txt|o=0|l=0", "v1", ["a.txt"], textResult("a"));
  cache.set("read|b.txt|o=0|l=0", "v1", ["b.txt"], textResult("b"));

  assert.equal(cache.invalidateSources(["a.txt"]), 1);
  assert.equal(cache.get("read|a.txt|o=0|l=0", "v1"), undefined);
  assert.ok(cache.get("read|b.txt|o=0|l=0", "v1"));
  assert.equal(cache.invalidateSources([]), 0);
});

test("the reuse notice names the source and how to force a fresh read", () => {
  const notice = formatReuseNotice({ path: "src/app.ts" });
  assert.match(notice, /src\/app\.ts/);
  assert.match(notice, /unchanged/i);
  assert.match(notice, /fresh read/i);
});

test("marking a reused result prepends the notice without mutating the stored result", () => {
  const original = textResult("line1\nline2");
  const marked = markReusedResult(original, "REUSED");

  assert.match((marked.content as any)[0].text, /^REUSED\n\nline1\nline2$/);
  assert.equal(marked.metadata?.resultReused, true);
  assert.equal((original.content as any)[0].text, "line1\nline2", "the stored result must stay notice-free");
  assert.equal(original.metadata?.resultReused, undefined);
});

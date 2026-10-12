import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("./AgentFilesPage.svelte", import.meta.url), "utf8").split("</script>")[0].replace('<script lang="ts">', "");
const ast = ts.createSourceFile("files.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join("\n");
const script = ts.transpileModule(functions, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
function fixture(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = {endpoint: "test", agentId: "a", generation: 0, rows: [], selected: null, loading: false, error: "", cursor: null, hasMore: false, failed: [], ...overrides};
  const api = new Function("state", `with(state) { ${script}; return {load, retry}; }`)(state);
  return {state, api};
}
const conversation = (id: string) => ({sessionId: id, contextId: "context", botId: "bot"});
const file = (id: string) => ({id, original: id, createdAt: "2026-10-11"});

test("Agent files paginate within the selected Agent and retry partial failures", async () => {
  let fail = true;
  const requests: any[] = [];
  const {state, api} = fixture({
    searchDesktopConversations: async (_: string, params: any) => {requests.push(params); return {groups: [{items: [conversation("one"), conversation("two")], nextCursor: "next", hasMore: true}]};},
    listDesktopSessionFiles: async (_: string, profile: string, session: string) => {assert.equal(profile, "bot"); if (session === "two" && fail) throw Error("offline"); return [file(session)];}
  });
  await api.load(true);
  assert.equal(requests[0].agentId, "a");
  assert.equal(requests[0].includeArchived, true);
  assert.equal(state.rows.length, 1);
  assert.equal(state.failed[0].sessionId, "two");
  assert.equal(state.cursor, "next");
  fail = false;
  await api.retry();
  assert.equal(state.rows.length, 2);
  assert.equal(state.failed.length, 0);
  await api.load();
  assert.equal(requests[1].cursor, "next");
  assert.equal(state.rows.length, 2);
});

test("Agent switch discards an old file response", async () => {
  let resolve!: (value: any) => void;
  const pending = new Promise(res => resolve = res);
  const {state, api} = fixture({searchDesktopConversations: async () => ({groups: [{items: [conversation("old")]}]}), listDesktopSessionFiles: () => pending});
  const load = api.load(true);
  await Promise.resolve();
  state.generation++;
  resolve([file("old")]);
  await load;
  assert.deepEqual(state.rows, []);
});

test("Agent file requests have at most four active reads", async () => {
  let active = 0, peak = 0;
  const {api} = fixture({searchDesktopConversations: async () => ({groups: [{items: Array.from({length: 12}, (_, i) => conversation(String(i)))}]}), listDesktopSessionFiles: async () => {peak = Math.max(peak, ++active); await new Promise(res => setTimeout(res, 1)); active--; return [];}});
  await api.load(true);
  assert.equal(peak, 4);
});


test("file groups separate origins and sort each type newest first", async () => {
  const { groupAgentFiles } = await import("./agentFileGroups");
  const rows = [
    {origin: "uploaded", original: "old.png", createdAt: "2026-10-10", mediaType: "image"},
    {origin: "generated", original: "new.py", createdAt: "2026-10-11", mediaType: "file"},
    {origin: "uploaded", original: "new.png", createdAt: "2026-10-11", mediaType: "image"},
    {origin: "unknown", original: "history.txt", createdAt: "2026-10-09", mediaType: "file"}
  ].map((file, index) => ({conversation: conversation(String(index)), file: {...file, id: String(index), local: file.original, size: 1}}));
  const groups = groupAgentFiles(rows as any);
  assert.deepEqual(groups.map(section => section.origin), ["generated", "uploaded", "unknown"]);
  assert.equal(groups[0].groups[0].type, "code");
  assert.equal(groups[2].groups[0].type, "text");
  assert.deepEqual(groups[1].groups[0].rows.map(row => row.file.original), ["new.png", "old.png"]);
});

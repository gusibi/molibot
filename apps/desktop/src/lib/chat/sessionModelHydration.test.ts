import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../ChatView.svelte", import.meta.url), "utf8").split("</script>")[0].replace('<script lang="ts">', "");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const hydrate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "hydrateSessionModel")!;
const reactive = ast.statements.find(node => ts.isLabeledStatement(node) && node.label.text === "$" && /modelSelectionHydrating\s*=/.test(node.statement.getText(ast)));
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture() {
  const pending = new Map<string, { resolve: (key: string) => void; reject: (error: Error) => void }>();
  const state = {
    connectedEndpoint: "isolated", activeSessionId: "old", activeModelKey: "default",
    sessionModelOverrides: new Map<string, string>(), hydratedModelSessions: new Set<string>(),
    modelHydrationSeq: 0, modelHydratingSessionId: "", modelSelectionHydrating: false,
    modelOptions: [{ key: "old-model" }, { key: "new-model" }],
    loadDesktopSessionModel: (_endpoint: string, id: string) => new Promise<string>((resolve, reject) => pending.set(id, { resolve, reject }))
  };
  const run = (id: string): Promise<void> => new Function("state", "id", `with(state) { ${compile(hydrate.getText(ast))}; return hydrateSessionModel(id); }`)(state, id);
  const disabled = () => new Function("state", `with(state) { ${reactive ? compile(reactive.getText(ast)) : ""}; return modelSelectionHydrating; }`)(state);
  return { state, pending, run, disabled };
}

test("leaving a loading Session immediately enables the Agent home composer and ignores its late response", async () => {
  const f = fixture();
  const done = f.run("old");
  assert.equal(f.disabled(), true);
  f.state.activeSessionId = "";
  const enabledOnHome = !f.disabled();
  f.pending.get("old")!.resolve("old-model");
  await done;
  assert.equal(enabledOnHome, true);
  assert.equal(f.disabled(), false);
  assert.equal(f.state.activeModelKey, "default");
  assert.equal(f.state.sessionModelOverrides.has("old"), false);
});

test("an old response cannot unlock or overwrite the newly loading Session", async () => {
  const f = fixture();
  const old = f.run("old");
  f.state.activeSessionId = "new";
  const next = f.run("new");
  f.pending.get("old")!.resolve("old-model");
  await old;
  assert.equal(f.disabled(), true);
  assert.equal(f.state.activeModelKey, "default");
  f.pending.get("new")!.resolve("new-model");
  await next;
  assert.equal(f.disabled(), false);
  assert.equal(f.state.activeModelKey, "new-model");
  assert.equal(f.state.sessionModelOverrides.get("new"), "new-model");
});

test("a failed Session model request releases the composer and permits retry", async () => {
  const f = fixture();
  const failed = f.run("old");
  f.pending.get("old")!.reject(new Error("isolated failure"));
  await failed;
  assert.equal(f.disabled(), false);
  assert.equal(f.state.hydratedModelSessions.has("old"), false);
  const retry = f.run("old");
  assert.equal(f.disabled(), true);
  f.pending.get("old")!.resolve("old-model");
  await retry;
  assert.equal(f.disabled(), false);
  assert.equal(f.state.activeModelKey, "old-model");
});

test("a cached Session selection invalidates an earlier pending read for that Session", async () => {
  const f = fixture();
  const pending = f.run("old");
  f.state.sessionModelOverrides.set("old", "new-model");
  f.state.activeModelKey = "new-model";
  await f.run("old");
  assert.equal(f.disabled(), false);
  f.pending.get("old")!.resolve("old-model");
  await pending;
  assert.equal(f.state.activeModelKey, "new-model");
  assert.equal(f.state.sessionModelOverrides.get("old"), "new-model");
});

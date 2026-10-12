import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../ChatView.svelte", import.meta.url), "utf8").split("</script>")[0].replace('<script lang="ts">', "");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const refresh = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshAgentActivity")!;
const script = ts.transpileModule(`${refresh.getText(ast)}\nreturn refreshAgentActivity();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture() {
  let resolve!: (items: unknown[]) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
  const state = { connectedEndpoint: "fixture", connectionGeneration: 1, connectionReady: true, agentActivities: [{ agentId: "default", status: "working" }], agentActivityReady: true, agentActivityError: "", loadDesktopAgentActivity: () => pending };
  const run = () => new Function("state", `with(state) { ${script} }`)(state) as Promise<void>;
  return { state, resolve, reject, run };
}

test("a previous connection's late activity response cannot replace the reconnected state", async () => {
  const f = fixture();
  const done = f.run();
  f.state.connectionGeneration++;
  f.state.agentActivities = [];
  f.state.agentActivityReady = false;
  f.resolve([{ agentId: "default", status: "working" }]);
  await done;
  assert.deepEqual(f.state.agentActivities, []);
  assert.equal(f.state.agentActivityReady, false);
});

test("an activity request failure clears stale working state and permits recovery", async () => {
  const f = fixture();
  const done = f.run();
  f.reject(new Error("Service unavailable"));
  await done;
  assert.deepEqual(f.state.agentActivities, []);
  assert.equal(f.state.agentActivityReady, false);
  assert.equal(f.state.agentActivityError, "Service unavailable");
  f.state.loadDesktopAgentActivity = async () => [];
  await f.run();
  assert.equal(f.state.agentActivityReady, true);
  assert.equal(f.state.agentActivityError, "");
});

const refreshSessions = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshAgentSessions")!;
const sessionsScript = ts.transpileModule(`${refreshSessions.getText(ast)}\nreturn refreshAgentSessions();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

test("unassigned history visibility uses its own query, including history outside the recent page", async () => {
  for (const exists of [true, false]) {
    const state = {
      connectedEndpoint: "fixture", connectionGeneration: 1, agentSessionsRequest: 0,
      ordinarySessions: [], hasUnassignedHistory: !exists,
      listDesktopConversations: async (_endpoint: string, params: { agentId?: string; limit: number; includeArchived: boolean }) => {
        if (params.agentId === "__unassigned__") {
          assert.equal(params.limit, 1);
          assert.equal(params.includeArchived, true);
          return { items: exists ? [{ sessionId: "older-unassigned" }] : [] };
        }
        return { items: [{ sessionId: "recent", agentId: "default" }] };
      }
    };
    await new Function("state", `with(state) { ${sessionsScript} }`)(state);
    assert.equal(state.hasUnassignedHistory, exists);
  }
});

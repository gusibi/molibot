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

function conversationRefresh(state: Record<string, unknown>): Promise<void> {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshConversations");
  assert.ok(fn, "conversation refresh must be wired to the production view");
  const compiled = ts.transpileModule(`${fn.getText(ast)}\nreturn refreshConversations();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("state", `with(state) { ${compiled} }`)(state);
}

test("conversation refresh updates external messages and the recent list used for sorting", async () => {
  const refreshed: string[] = [];
  const state = {
    connectedEndpoint: "fixture", connectionGeneration: 1, connectionReady: true,
    conversationRefreshing: false, conversationRefreshError: "old error", viewMode: "external",
    refreshAgentSessions: async () => { refreshed.push("recent and agent ordering"); },
    refreshExternalTranscript: async () => { refreshed.push("selected transcript"); }
  };
  const done = conversationRefresh(state);
  assert.equal(state.conversationRefreshing, true);
  await done;
  assert.deepEqual(refreshed.sort(), ["recent and agent ordering", "selected transcript"]);
  assert.equal(state.conversationRefreshing, false);
  assert.equal(state.conversationRefreshError, "");
});

test("refresh failure is visible and can recover without losing the active selection", async () => {
  const state = {
    connectedEndpoint: "fixture", connectionGeneration: 1, connectionReady: true,
    conversationRefreshing: false, conversationRefreshError: "", viewMode: "external",
    refreshAgentSessions: async (): Promise<void> => { throw new Error("Service unavailable"); },
    refreshExternalTranscript: async () => {}
  };
  await conversationRefresh(state);
  assert.equal(state.conversationRefreshError, "Service unavailable");
  assert.equal(state.conversationRefreshing, false);
  state.refreshAgentSessions = async () => {};
  await conversationRefresh(state);
  assert.equal(state.conversationRefreshError, "");
});

test("a late refresh cannot change the reconnected view's error or busy state", async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const state = {
    connectedEndpoint: "fixture", connectionGeneration: 1, connectionReady: true,
    conversationRefreshing: false, conversationRefreshError: "", viewMode: "local",
    refreshAgentSessions: () => pending, refreshExternalTranscript: async () => {}
  };
  const done = conversationRefresh(state);
  state.connectionGeneration++;
  state.conversationRefreshError = "current connection error";
  reject(new Error("old connection error"));
  await done;
  assert.equal(state.conversationRefreshing, true);
  assert.equal(state.conversationRefreshError, "current connection error");
});

test("visible conversation polling and refresh control share the same refresh task", () => {
  const start = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "startConversationPolling");
  const stop = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "stopConversationPolling");
  assert.ok(start && stop);
  assert.match(start.getText(ast), /new ActivityScheduler\(agentActivityPolicy, refreshConversations, documentActivityVisibility\)/);
  assert.match(start.getText(ast), /conversationScheduler.start\(\)/);
  assert.match(stop.getText(ast), /conversationScheduler\?\.dispose\(\)/);
  const view = readFileSync(new URL("../../ChatView.svelte", import.meta.url), "utf8");
  assert.match(view, /title=\{copy.conversationRefresh\} disabled=\{conversationRefreshing \|\| externalTranscriptLoading\} onclick=\{\(\) => conversationScheduler\?\.wake\("manual"\)\}/);
  assert.match(view, /startAgentActivityPolling\(\);\s*startConversationPolling\(\)/);
  assert.match(view, /stopAgentActivityPolling\(\);\s*stopConversationPolling\(\)/);
});

function fileRefresh(state: Record<string, unknown>): Promise<void> {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshFiles");
  assert.ok(fn);
  const compiled = ts.transpileModule(`${fn.getText(ast)}\nreturn refreshFiles("bot", "qq");`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("state", `with(state) { ${compiled} }`)(state);
}

test("file refresh keeps playable cached files on failure and recovers", async () => {
  const state = {
    connectedEndpoint: "fixture", connectionGeneration: 1, filesRequest: 0,
    sessionFiles: ["voice.ogg"], conversationRefreshError: "",
    isCurrentFileSession: () => true,
    listDesktopSessionFiles: async (): Promise<string[]> => { throw new Error("Files unavailable"); }
  };
  await fileRefresh(state);
  assert.deepEqual(state.sessionFiles, ["voice.ogg"]);
  assert.equal(state.conversationRefreshError, "Files unavailable");
  state.listDesktopSessionFiles = async () => ["new-voice.ogg"];
  await fileRefresh(state);
  assert.deepEqual(state.sessionFiles, ["new-voice.ogg"]);
});

test("late file refresh cannot overwrite newer files or a reconnected session", async () => {
  let resolve!: (value: string[]) => void;
  const pending = new Promise<string[]>(done => { resolve = done; });
  const state = {
    connectedEndpoint: "fixture", connectionGeneration: 1, filesRequest: 0,
    sessionFiles: ["voice.ogg"], conversationRefreshError: "",
    isCurrentFileSession: () => true, listDesktopSessionFiles: () => pending
  };
  const old = fileRefresh(state);
  state.listDesktopSessionFiles = async () => ["current.ogg"];
  await fileRefresh(state);
  resolve(["stale.ogg"]);
  await old;
  assert.deepEqual(state.sessionFiles, ["current.ogg"]);
  let reconnectResolve!: (value: string[]) => void;
  state.listDesktopSessionFiles = () => new Promise(done => { reconnectResolve = done; });
  const reconnect = fileRefresh(state);
  state.connectionGeneration++;
  reconnectResolve(["previous-connection.ogg"]);
  await reconnect;
  assert.deepEqual(state.sessionFiles, ["current.ogg"]);
});

test("external refresh updates media files for its captured session and never for a new selection", async () => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshExternalTranscript");
  assert.ok(fn);
  const compiled = ts.transpileModule(`${fn.getText(ast)}\nreturn refreshExternalTranscript();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  for (const switchSession of [false, true]) {
    const files: string[] = [];
    const state = {
      connectedEndpoint: "fixture", viewMode: "external", activeExternalSessionId: "qq",
      ordinarySessions: [{ sessionId: "qq", botId: "bot" }],
      externalTranscript: null, externalTranscriptLoading: false, externalTranscriptError: "", activeExternalTitle: "old",
      externalTranscriptLoader: { select: async (_endpoint: string, _id: string, publish: (state: unknown) => void) => {
        publish({ transcript: { title: "Fresh title" }, loading: false, error: "" });
        if (switchSession) state.activeExternalSessionId = "other";
      } },
      refreshFiles: async (bot: string, session: string) => { files.push(`${bot}:${session}`); }
    };
    await new Function("state", `with(state) { ${compiled} }`)(state);
    assert.equal(state.activeExternalTitle, "Fresh title");
    assert.deepEqual(files, switchSession ? [] : ["bot:qq"]);
  }
});

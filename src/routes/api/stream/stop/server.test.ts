import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "molibot-cancel-route-"));
process.env.DATA_DIR = dataDir;
const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
const { getWebRuntimeContext } = await import("$lib/server/web/runtimeContext.js");
const { POST } = await import("./+server.js");
const globals = globalThis as any;
globals.__molibotRuntime = {
  getSettings: () => defaultRuntimeSettings,
  updateSettings: () => {},
  sessions: {
    getConversationProjectId: () => null,
    getWebConversationOwner: () => "web:personal:web-anonymous"
  }
};
const runner = getWebRuntimeContext("personal").pool.get("web:personal:web-anonymous", "session");
const state = runner as any;
const sources: string[] = [];
state.abort = (source: string) => { sources.push(source); state.running = false; };
async function call(recoveryRunId?: unknown) {
  const response = await POST({ request: new Request("http://isolated.invalid/api/stream/stop", {
    method: "POST", body: JSON.stringify({ profileId: "personal", conversationId: "session", recoveryRunId })
  }) } as any);
  return { status: response.status, payload: await response.json() };
}
test.after(() => {
  delete globals.__molibotRuntime;
  rmSync(dataDir, { recursive: true, force: true });
});

test("automatic recovery cannot stop background or newer runs; explicit Stop still can", async () => {
  state.running = true;
  state.activeExecutionOwner = "runtime";
  state.activeHookContext = { runId: "background-attempt" };
  assert.deepEqual(await call("background-attempt"), { status: 200, payload: { ok: true, stopped: false } });
  assert.deepEqual(sources, []);
  assert.equal(state.running, true);
  assert.deepEqual(await call(), { status: 200, payload: { ok: true, stopped: true } });
  assert.deepEqual(sources, ["user_stop"]);
  state.running = true;
  state.activeExecutionOwner = "client";
  state.activeHookContext = { runId: "new-turn" };
  assert.deepEqual(await call("old-turn"), { status: 200, payload: { ok: true, stopped: false } });
  assert.equal(state.running, true);
  assert.deepEqual(await call("new-turn"), { status: 200, payload: { ok: true, stopped: true } });
  assert.deepEqual(sources, ["user_stop", "orphan_recovery"]);
});

test("malformed automatic recovery cannot become an unbound Stop", async () => {
  state.running = true;
  state.activeExecutionOwner = "runtime";
  state.activeHookContext = { runId: "background-attempt" };
  for (const value of ["", "   ", null, 1]) assert.equal((await call(value)).status, 400);
  assert.equal(state.running, true);
  state.running = false;
});

import assert from "node:assert/strict";
import test from "node:test";

const globals = globalThis as any;
globals.$state = Object.assign((value: unknown) => value, { raw: (value: unknown) => value });
globals.$derived = Object.assign((value: unknown) => value, { by: (read: () => unknown) => read() });
const { ChatSessionStore } = await import("./chatSessionStore.svelte");

test("reconnect binds cancellation to the listed run and counts only actual stops", async () => {
  const originalFetch = globalThis.fetch;
  const calls: any[] = [];
  let available = false;
  globalThis.fetch = async (input, init) => {
    if (!available) throw new Error("isolated service unavailable");
    if (String(input).endsWith("/session-runs")) return new Response(JSON.stringify({ ok: true, runs: [
      { profileId: "default", sessionId: "background-session", runId: "background-attempt" },
      { profileId: "default", sessionId: "orphan-session", runId: "orphan-turn" },
      { profileId: "default", sessionId: "missing-identity" }
    ] }));
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return new Response(JSON.stringify({ ok: true, stopped: body.recoveryRunId === "orphan-turn" }));
  };
  try {
    const store = new ChatSessionStore();
    store.init({ endpoint: () => "http://isolated.invalid", modelReady: () => true,
      labels: () => ({} as any), loadTranscript: async () => [] });
    assert.equal(await store.reconnect(), 0);
    assert.deepEqual(calls, []);
    available = true;
    assert.equal(await store.reconnect(), 1);
    assert.deepEqual(calls, [
      { profileId: "default", conversationId: "background-session", recoveryRunId: "background-attempt" },
      { profileId: "default", conversationId: "orphan-session", recoveryRunId: "orphan-turn" }
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

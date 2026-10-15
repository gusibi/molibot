import assert from "node:assert/strict";
import test from "node:test";

const globals = globalThis as any;
globals.$state = Object.assign((value: unknown) => value, { raw: (value: unknown) => value });
globals.$derived = Object.assign((value: unknown) => value, { by: (read: () => unknown) => read() });
const { ChatSessionStore } = await import("./chatSessionStore.svelte");

test("reconnect adopts orphaned runs for recovery instead of aborting them", async () => {
  const originalFetch = globalThis.fetch;
  const stops: any[] = [];
  let available = false;
  globalThis.fetch = async (input, init) => {
    if (!available) throw new Error("isolated service unavailable");
    if (String(input).endsWith("/session-runs")) return new Response(JSON.stringify({ ok: true, runs: [
      { profileId: "default", sessionId: "background-session", runId: "background-attempt" },
      { profileId: "default", sessionId: "orphan-session", runId: "orphan-turn" },
      { profileId: "default", sessionId: "missing-identity" }
    ] }));
    stops.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }));
  };
  try {
    const store = new ChatSessionStore();
    store.init({ endpoint: () => "http://isolated.invalid", modelReady: () => true,
      labels: () => ({} as any), loadTranscript: async () => [] });
    // The recovery loop polls with timers; stub the controller's entry point so
    // the store contract (who gets adopted, and that nothing is aborted) is what
    // this test asserts.
    const recovered: string[] = [];
    (store.registry as any).getOrCreate = (_profileId: string, sessionId: string) => ({
      controller: { sending: false, recoverRunningTurn: async () => { recovered.push(sessionId); } }
    });
    assert.equal(await store.reconnect(), 0);
    assert.deepEqual(stops, []);
    available = true;
    assert.equal(await store.reconnect(), 2);
    assert.deepEqual(recovered, ["background-session", "orphan-session"], "runs with identity are adopted");
    assert.deepEqual(stops, [], "reconnect must not abort the runs it adopts");
  } finally { globalThis.fetch = originalFetch; }
});


test("first send retains its draft settings while another Agent becomes active", async () => {
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
  try {
    const store = new ChatSessionStore();
    const snapshots: unknown[] = [];
    const sent: unknown[] = [];
    store.init({ endpoint: () => "http://isolated.invalid", modelReady: () => true,
      labels: () => ({} as any), loadTranscript: async () => [],
      onDraftSessionCreated: (_profile, _id, draft) => { snapshots.push(draft); } });
    store.newConversationDraft("agent-researcher");
    store.draftStore.update("__new_conversation__:agent-researcher", { modelKey: "research-model", thinkingLevel: "high" });
    (store.registry as any).getOrCreate = () => ({ controller: { send: async (input: unknown) => { sent.push(input); } } });
    const pending = store.send("Research", []);
    store.newConversationDraft("agent-writer");
    store.draftStore.update("__new_conversation__:agent-writer", { text: "Writer draft", modelKey: "writer-model" });
    release(new Response(JSON.stringify({ ok: true, session: { id: "research-session" }, reused: false })));
    await pending;
    assert.equal(store.draftProfileId, "agent-writer");
    assert.equal(store.draftMode, true);
    assert.equal(store.registry.active, undefined);
    assert.equal((snapshots[0] as { modelKey: string }).modelKey, "research-model");
    assert.equal(store.draftStore.get("__new_conversation__:agent-writer").text, "Writer draft");
    assert.deepEqual(sent, [{ message: "Research", files: [] }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("first send does not consume a new draft after returning to the same Agent", async () => {
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
  try {
    const store = new ChatSessionStore();
    const snapshots: unknown[] = [];
    const sent: unknown[] = [];
    store.init({ endpoint: () => "http://isolated.invalid", modelReady: () => true,
      labels: () => ({} as any), loadTranscript: async () => [],
      onDraftSessionCreated: (_profile, _id, draft) => { snapshots.push(draft); } });
    store.newConversationDraft("agent-researcher");
    store.draftStore.update("__new_conversation__:agent-researcher", { modelKey: "research-model", thinkingLevel: "high" });
    (store.registry as any).getOrCreate = () => ({ controller: { send: async (input: unknown) => { sent.push(input); } } });
    const pending = store.send("Research", []);
    store.newConversationDraft("agent-writer");
    store.draftStore.update("__new_conversation__:agent-writer", { text: "Writer draft", modelKey: "writer-model" });
    store.newConversationDraft("agent-researcher");
    store.draftStore.update("__new_conversation__:agent-researcher", { text: "New research draft", modelKey: "new-model" });
    release(new Response(JSON.stringify({ ok: true, session: { id: "research-session" }, reused: false })));
    await pending;
    assert.equal(store.draftProfileId, "agent-researcher");
    assert.equal(store.draftStore.get("__new_conversation__:agent-researcher").text, "New research draft");
    assert.equal(store.draftMode, true);
    assert.equal(store.registry.active, undefined);
    assert.equal((snapshots[0] as { modelKey: string }).modelKey, "research-model");
    assert.equal(store.draftStore.get("__new_conversation__:agent-writer").text, "Writer draft");
    assert.deepEqual(sent, [{ message: "Research", files: [] }]);
  } finally { globalThis.fetch = originalFetch; }
});

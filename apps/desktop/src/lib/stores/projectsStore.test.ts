import assert from "node:assert/strict";
import test from "node:test";

type DeferredResponse = {
  resolve: (response: Response) => void;
  promise: Promise<Response>;
};

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { resolve, promise };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("the latest project selection owns the session list and transcript", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProject } = await import("./projects.svelte.js");
  Object.assign(projectsStore, {
    endpoint: "http://desktop.test",
    projects: [],
    selectedProjectId: "",
    sessions: [],
    selectedSessionId: "",
    messages: [],
    loading: false,
    busy: "",
    error: ""
  });

  const aSessions = deferredResponse();
  const bSessions = deferredResponse();
  const bTranscript = deferredResponse();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/projects/a/sessions")) return aSessions.promise;
    if (url.endsWith("/projects/b/sessions")) return bSessions.promise;
    if (url.endsWith("/projects/b/sessions/b-1")) return bTranscript.promise;
    if (url.endsWith("/projects/b/sessions/a-1")) {
      return jsonResponse({ ok: false, error: "Unknown project session" }, 404);
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const selectingA = selectProject("a");
    const selectingB = selectProject("b");
    bSessions.resolve(jsonResponse({ ok: true, sessions: [{ conversationId: "b-1", title: "B", updatedAt: "2026-07-09T01:00:00.000Z", origin: "web" }] }));
    await Promise.resolve();
    bTranscript.resolve(jsonResponse({ ok: true, messages: [{ id: "m-b", conversationId: "b-1", role: "assistant", content: "Project B", createdAt: "2026-07-09T01:00:00.000Z" }] }));
    await selectingB;

    aSessions.resolve(jsonResponse({ ok: true, sessions: [{ conversationId: "a-1", title: "A", updatedAt: "2026-07-09T00:00:00.000Z", origin: "web" }] }));
    await selectingA;

    assert.equal(projectsStore.selectedProjectId, "b");
    assert.equal(projectsStore.selectedSessionId, "b-1");
    assert.equal(projectsStore.sessions[0]?.conversationId, "b-1");
    assert.equal(projectsStore.messages[0]?.content, "Project B");
    assert.equal(projectsStore.error, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

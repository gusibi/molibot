import assert from "node:assert/strict";
import test from "node:test";

(globalThis as any).$derived = (value: unknown) => value;

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

test("the latest project selection owns the session list without selecting a transcript", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProject } = await import("./projects.svelte.js");
  Object.assign(projectsStore, {
    endpoint: "http://desktop.test",
    projects: [],
    selectedProjectId: "",
    sessionsByProject: {},
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
    assert.equal(projectsStore.selectedSessionId, "");
    assert.equal(projectsStore.sessions[0]?.conversationId, "b-1");
    assert.deepEqual(projectsStore.messages, []);
    assert.equal(projectsStore.error, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selecting a project session repins the Project Chat transcript", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProjectSession } = await import("./projects.svelte.js");
  const { projectChatStore } = await import("../projects/projectChatStore.svelte.js");
  projectChatStore.disposeAll();
  projectChatStore.init({
    endpoint: () => projectsStore.endpoint,
    modelReady: () => true,
    labels: () => ({ working: "Working", uploading: "Uploading", recognizingImage: "Recognizing image", stopped: "Stopped", idle: "Idle", resuming: "Resuming" }),
    resolveModel: () => "model",
    resolveThinking: () => "medium"
  });
  Object.assign(projectsStore, {
    endpoint: "http://desktop.test",
    selectedProjectId: "project",
    selectedSessionId: "",
    messages: [],
    messagesLoading: false,
    error: ""
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/projects/project/sessions/session-a")) {
      return jsonResponse({ ok: true, messages: [{ id: "m-a", conversationId: "session-a", role: "assistant", content: "Session A", createdAt: "2026-07-14T00:00:00.000Z" }] });
    }
    if (url.endsWith("/projects/project/sessions/session-b")) {
      return jsonResponse({ ok: true, messages: [{ id: "m-b", conversationId: "session-b", role: "assistant", content: "Session B", createdAt: "2026-07-14T00:01:00.000Z" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    await selectProjectSession("session-a", "project");
    await projectChatStore.reloadActive();
    assert.equal(projectChatStore.registry.active?.sessionId, "session-a");
    assert.equal(projectChatStore.registry.active?.messages[0]?.content, "Session A");

    await selectProjectSession("session-b", "project");
    await projectChatStore.reloadActive();
    assert.equal(projectChatStore.registry.active?.sessionId, "session-b");
    assert.equal(projectChatStore.registry.active?.messages[0]?.content, "Session B");
  } finally {
    globalThis.fetch = originalFetch;
    projectChatStore.disposeAll();
  }
});

test("a successful project transcript load hydrates the Project Chat runtime", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProjectSession } = await import("./projects.svelte.js");
  const { projectChatStore } = await import("../projects/projectChatStore.svelte.js");
  projectChatStore.disposeAll();
  projectChatStore.init({
    endpoint: () => projectsStore.endpoint,
    modelReady: () => true,
    labels: () => ({ working: "Working", uploading: "Uploading", recognizingImage: "Recognizing image", stopped: "Stopped", idle: "Idle", resuming: "Resuming" }),
    resolveModel: () => "model",
    resolveThinking: () => "medium"
  });
  Object.assign(projectsStore, {
    endpoint: "http://desktop.test",
    selectedProjectId: "project",
    selectedSessionId: "",
    messages: [],
    messagesLoading: false,
    error: ""
  });

  let transcriptRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.endsWith("/projects/project/sessions/session-a")) {
      throw new Error(`Unexpected request: ${url}`);
    }
    transcriptRequests += 1;
    return jsonResponse({ ok: true, messages: [{ id: "m-a", conversationId: "session-a", role: "assistant", content: "Recovered transcript", createdAt: "2026-07-15T00:00:00.000Z" }] });
  }) as typeof fetch;

  try {
    await selectProjectSession("session-a", "project");
    assert.equal(transcriptRequests, 1);
    assert.equal(projectsStore.messages[0]?.content, "Recovered transcript");
    assert.equal(projectChatStore.registry.active?.messages[0]?.content, "Recovered transcript");
  } finally {
    globalThis.fetch = originalFetch;
    projectChatStore.disposeAll();
  }
});

test("an overlapping Project transcript hydration does not duplicate the live assistant row", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProjectSession } = await import("./projects.svelte.js");
  const { projectChatStore } = await import("../projects/projectChatStore.svelte.js");
  projectChatStore.disposeAll();
  projectChatStore.init({
    endpoint: () => projectsStore.endpoint,
    modelReady: () => true,
    labels: () => ({ working: "Working", uploading: "Uploading", recognizingImage: "Recognizing image", stopped: "Stopped", idle: "Idle", resuming: "Resuming" }),
    resolveModel: () => "model",
    resolveThinking: () => "medium"
  });
  Object.assign(projectsStore, {
    endpoint: "http://desktop.test",
    selectedProjectId: "project",
    selectedSessionId: "session-a",
    messages: [],
    messagesLoading: false,
    error: ""
  });

  const existing = [{
    id: "user-current",
    conversationId: "session-a",
    role: "user" as const,
    content: "[$dbs-diagnosis] 先检查",
    createdAt: "2026-07-19T08:56:51.045Z"
  }];
  projectChatStore.selectSession("session-a", "project", existing);
  const entry = projectChatStore.registry.active!;
  entry.controller.sending = true;

  const transcript = deferredResponse();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.endsWith("/projects/project/sessions/session-a")) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return transcript.promise;
  }) as typeof fetch;

  try {
    const selecting = selectProjectSession("session-a", "project");
    transcript.resolve(jsonResponse({
      ok: true,
      messages: [
        ...existing,
        {
          id: "assistant-tool-use",
          conversationId: "session-a",
          role: "assistant",
          content: "",
          thinking: "先读取 skill",
          createdAt: "2026-07-19T08:56:51.088Z"
        }
      ]
    }));
    await selecting;

    const assistantRows = entry.messages.filter((message) => message.role === "assistant").length
      + Number(entry.controller.sending);
    assert.equal(assistantRows, 1);
    assert.deepEqual(entry.messages.map((message) => message.id), ["user-current"]);
  } finally {
    entry.controller.sending = false;
    globalThis.fetch = originalFetch;
    projectChatStore.disposeAll();
  }
});


test("project lists retain refreshed titles across project selection and failed revalidation", async () => {
  (globalThis as any).$state = <T>(value: T): T => value;
  const { projectsStore, selectProject, refreshProjectSessionList } = await import("./projects.svelte.js");
  projectsStore.endpoint = "http://desktop.test";
  const originalFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = (async () => {
    if (fail) throw new Error("offline");
    return jsonResponse({ ok: true, sessions: [{ conversationId: "cache-session", title: "Updated title", updatedAt: "2026-09-07", origin: "web" }] });
  }) as typeof fetch;
  try {
    await selectProject("cached-project");
    await refreshProjectSessionList("cached-project");
    await selectProject("other-project");
    fail = true;
    const selecting = selectProject("cached-project");
    assert.equal(projectsStore.sessions[0]?.title, "Updated title");
    await selecting;
    assert.equal(projectsStore.sessions[0]?.title, "Updated title");
  } finally { globalThis.fetch = originalFetch; }
});

test("project refreshes deduplicate and an older response cannot undo a rename or deletion", async () => {
  const { projectsStore, refreshProjectSessionList, renameProjectSession, removeProjectSession } = await import("./projects.svelte.js");
  projectsStore.endpoint = "http://desktop.test";
  const session = { conversationId: "race-session", title: "New Session", updatedAt: "2026-09-07", origin: "web" };
  projectsStore.sessionsByProject["race-project"] = [session];
  const originalFetch = globalThis.fetch;
  let pending = deferredResponse();
  let reads = 0;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") return jsonResponse({ ok: true, conversation: { ...session, id: session.conversationId, title: "Renamed" } });
    if (init?.method === "DELETE") return jsonResponse({ ok: true });
    reads++;
    return pending.promise;
  }) as typeof fetch;
  try {
    const first = refreshProjectSessionList("race-project");
    const duplicate = refreshProjectSessionList("race-project");
    await Promise.resolve();
    assert.equal(reads, 1);
    await renameProjectSession("race-session", "Renamed", "race-project");
    pending.resolve(jsonResponse({ ok: true, sessions: [session] }));
    await Promise.all([first, duplicate]);
    assert.equal(projectsStore.sessionsByProject["race-project"][0].title, "Renamed");
    pending = deferredResponse();
    const beforeDelete = refreshProjectSessionList("race-project");
    await Promise.resolve();
    await removeProjectSession("race-session", "race-project");
    pending.resolve(jsonResponse({ ok: true, sessions: [session] }));
    await beforeDelete;
    assert.deepEqual(projectsStore.sessionsByProject["race-project"], []);
  } finally { globalThis.fetch = originalFetch; }
});

test("a newer forced refresh owns the result", async () => {
  const { projectsStore, refreshProjectSessionList } = await import("./projects.svelte.js");
  const originalFetch = globalThis.fetch;
  const old = deferredResponse();
  const fresh = deferredResponse();
  let calls = 0;
  globalThis.fetch = (async () => (++calls === 1 ? old.promise : fresh.promise)) as typeof fetch;
  try {
    const first = refreshProjectSessionList("ordered-project");
    await Promise.resolve();
    const second = refreshProjectSessionList("ordered-project", true);
    await Promise.resolve();
    fresh.resolve(jsonResponse({ ok: true, sessions: [{ conversationId: "new", title: "Fresh" }] }));
    await second;
    old.resolve(jsonResponse({ ok: true, sessions: [] }));
    await first;
    assert.equal(projectsStore.sessionsByProject["ordered-project"][0].title, "Fresh");
    assert.equal(projectsStore.sessionListLoading["ordered-project"], false);
  } finally { globalThis.fetch = originalFetch; }
});

test("a created session remains visible when its follow-up list request fails", async () => {
  const { projectsStore, newProjectSession } = await import("./projects.svelte.js");
  const originalFetch = globalThis.fetch;
  projectsStore.endpoint = "http://desktop.test";
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") return jsonResponse({ ok: true, reused: false, session: { conversationId: "created-session", title: "New Session", updatedAt: "2026-09-07", origin: "web" } });
    if (String(input).endsWith("/created-session")) return jsonResponse({ ok: true, messages: [] });
    return jsonResponse({ ok: false, error: "offline" }, 503);
  }) as typeof fetch;
  try {
    await newProjectSession("created-project");
    assert.equal(projectsStore.selectedProjectId, "created-project");
    assert.equal(projectsStore.selectedSessionId, "created-session");
    assert.equal(projectsStore.sessions[0]?.conversationId, "created-session");
  } finally { globalThis.fetch = originalFetch; }
});

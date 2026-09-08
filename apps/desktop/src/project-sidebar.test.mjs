import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Compile the actual sidebar and store together; source-pattern checks cannot
// detect a successful refresh that updates a different list from the renderer.
test("Project sidebar renders refreshed titles and preserves rows during revalidation", async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("..", import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: "error"
  });
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ project: true }) };
  try {
    const { default: ProjectTree } = await server.ssrLoadModule("/src/lib/projects/ProjectTree.svelte");
    const { projectsStore, refreshProjectSessionList, selectProject } = await server.ssrLoadModule("/src/lib/stores/projects.svelte.ts");
    const { translator } = await server.ssrLoadModule("/src/lib/i18n.ts");
    const { render } = await server.ssrLoadModule("svelte/server");
    const copy = translator("en");
    projectsStore.endpoint = "http://sidebar.test";
    projectsStore.projects = [{ id: "project", name: "Project" }];
    projectsStore.selectedProjectId = "project";
    globalThis.fetch = async () => Response.json({ ok: true, sessions: [{ conversationId: "session", title: "Updated title", updatedAt: "2026-09-07", origin: "web" }] });
    const draw = () => render(ProjectTree, { props: {
      endpoint: projectsStore.endpoint, copy, expanded: true,
      formatTime: () => "now", onToggle() {}, onActivateSession() {}
    } }).body;
    await refreshProjectSessionList("project");
    assert.match(draw(), /Updated title/);
    projectsStore.selectedProjectId = "other";
    assert.match(draw(), /Updated title/);
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    const selection = selectProject("project");
    await Promise.resolve();
    assert.match(draw(), /Updated title/);
    finish(Response.json({ ok: false, error: "offline" }, { status: 503 }));
    await selection;
    assert.match(draw(), /Updated title/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    await server.close();
  }
});

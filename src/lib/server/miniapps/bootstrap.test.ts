import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureBuiltinMiniApps } from "$lib/server/miniapps/bootstrap.js";
import { createMiniAppHost, type MiniAppEnablementEntry } from "$lib/server/miniapps/host.js";

/**
 * Built-in bootstrap, plus the Todo app's own end-to-end behaviour.
 *
 * Todo is both the reference implementation and the proof the platform closes:
 * an agent tool call and an HTTP request must land in the same SQLite file, and
 * a code upgrade must not touch the owner's data.
 */

function makeRoots() {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-bootstrap-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  return { root, codeRoot, dataRoot };
}

function hostOver(codeRoot: string, dataRoot: string, enablement: Record<string, MiniAppEnablementEntry>) {
  return createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete enablement[appId];
      else enablement[appId] = entry;
    },
    builtinAppIds: ["todo"]
  });
}

test("an empty owner workspace gets the Todo app on first start", () => {
  const { codeRoot } = makeRoots();
  const result = ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });

  assert.deepEqual(result.installed, ["todo"]);
  for (const file of ["manifest.json", "server/index.mjs", "ui/index.html", "ui/app.js", "ui/styles.css"]) {
    assert.ok(existsSync(join(codeRoot, "todo", file)), `${file} should be installed`);
  }
  // No staging directory may survive a successful install.
  assert.equal(existsSync(join(codeRoot, "todo.installing")), false);
});

test("bootstrap never overwrites an owner's own copy of a built-in", () => {
  const { codeRoot } = makeRoots();
  mkdirSync(join(codeRoot, "todo"), { recursive: true });
  writeFileSync(join(codeRoot, "todo", "manifest.json"), "{\"mine\":true}", "utf8");

  const result = ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });

  assert.deepEqual(result.installed, []);
  assert.deepEqual(result.skipped, [{ id: "todo", reason: "already-installed" }]);
  assert.equal(readFileSync(join(codeRoot, "todo", "manifest.json"), "utf8"), "{\"mine\":true}");
});

test("an uninstalled built-in is not silently reinstalled on the next start", () => {
  const { codeRoot } = makeRoots();
  const result = ensureBuiltinMiniApps({
    codeRoot,
    getEnablement: () => ({ todo: { enabled: false, removedBuiltin: true } })
  });

  assert.deepEqual(result.installed, []);
  assert.deepEqual(result.skipped, [{ id: "todo", reason: "removed-by-owner" }]);
  assert.equal(existsSync(join(codeRoot, "todo")), false);
});

test("the bootstrapped Todo app loads and exposes its four tools", () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});

  const entry = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(entry?.status, "active", entry?.error);
  assert.equal(entry?.builtin, true);
  assert.deepEqual(entry?.toolNames, ["add", "list", "complete", "remove"]);
});

test("Todo supports add / list / complete / delete through the agent tools", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});
  const call = (tool: string, input: unknown) =>
    host.invokeTool(`miniapp__todo__${tool}`, input, { toolCallId: `t-${tool}` });

  const added = await call("add", { title: "买牛奶" }) as any;
  const id = added.structuredContent.id as string;
  assert.match(added.content[0].text, /买牛奶/);

  const open = await call("list", { status: "open" }) as any;
  assert.deepEqual(open.structuredContent.map((row: any) => row.title), ["买牛奶"]);

  await call("complete", { id });
  const stillOpen = await call("list", { status: "open" }) as any;
  assert.deepEqual(stillOpen.structuredContent, []);
  const completed = await call("list", { status: "completed" }) as any;
  assert.equal(completed.structuredContent[0].completed, true);
  assert.ok(completed.structuredContent[0].completedAt, "completion records a timestamp");

  await call("remove", { id });
  const all = await call("list", { status: "all" }) as any;
  assert.deepEqual(all.structuredContent, []);
});

test("Todo's agent tools and HTTP API read and write the same list", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});
  const request = (path: string, init?: RequestInit) =>
    host.handleHttp("todo", new Request(`http://127.0.0.1/miniapps/todo/api${path}`, init), path);

  await host.invokeTool("miniapp__todo__add", { title: "from agent" }, { toolCallId: "t1" });
  const seenByUi = await (await request("/todos")).json();
  assert.deepEqual(seenByUi.todos.map((row: any) => row.title), ["from agent"]);

  const created = await request("/todos", { method: "POST", body: JSON.stringify({ title: "from ui" }) });
  assert.equal(created.status, 201);
  const seenByAgent = await host.invokeTool("miniapp__todo__list", { status: "all" }, { toolCallId: "t2" });
  assert.deepEqual(
    (seenByAgent.structuredContent as any[]).map((row) => row.title).sort(),
    ["from agent", "from ui"]
  );

  // Completing from the UI must be visible to the agent immediately.
  const uiId = (await created.json()).todo.id as string;
  await request(`/todos/${uiId}`, { method: "PATCH", body: JSON.stringify({ completed: true }) });
  const openOnly = await host.invokeTool("miniapp__todo__list", { status: "open" }, { toolCallId: "t3" });
  assert.deepEqual((openOnly.structuredContent as any[]).map((row) => row.title), ["from agent"]);
});

test("20 concurrent adds keep every item and advance the revision monotonically", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      host.invokeTool("miniapp__todo__add", { title: `item-${index}` }, { toolCallId: `t${index}` })
    )
  );

  const listed = await host.invokeTool("miniapp__todo__list", { status: "all" }, { toolCallId: "final" });
  const titles = (listed.structuredContent as any[]).map((row) => row.title).sort();
  assert.equal(titles.length, 20);
  assert.equal(new Set(titles).size, 20, "no add may overwrite another");
  assert.equal(host.getRevision("todo"), 20);
});

test("replacing the app code leaves the owner's todos intact", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});
  await host.invokeTool("miniapp__todo__add", { title: "survive the upgrade" }, { toolCallId: "t1" });

  // An upgrade replaces apps/<id> wholesale and restarts; data/<id> is untouched.
  const bumped = JSON.parse(readFileSync(join(codeRoot, "todo", "manifest.json"), "utf8"));
  bumped.version = "1.1.0";
  writeFileSync(join(codeRoot, "todo", "manifest.json"), JSON.stringify(bumped), "utf8");

  const restarted = hostOver(codeRoot, dataRoot, {});
  assert.equal(restarted.listCatalog().find((row) => row.id === "todo")?.version, "1.1.0");
  const listed = await restarted.invokeTool("miniapp__todo__list", { status: "all" }, { toolCallId: "t2" });
  assert.deepEqual((listed.structuredContent as any[]).map((row) => row.title), ["survive the upgrade"]);
});

test("the destructive Todo tool is the delete, and only the delete", () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});
  const byName = new Map(host.listTools().map((tool) => [tool.toolName, tool]));

  assert.equal(byName.get("remove")?.destructiveHint, true);
  assert.equal(byName.get("complete")?.destructiveHint, false, "completing is not destructive");
  assert.equal(byName.get("add")?.destructiveHint, false);
  assert.equal(byName.get("list")?.readOnlyHint, true);
});

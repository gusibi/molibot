import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import manifestSource from "$lib/server/miniapps/builtin/todo/manifest.json?raw";
import {
  builtinMiniAppIds,
  ensureBuiltinMiniApps,
  getBuiltinMiniApp,
  listBuiltinMiniApps
} from "$lib/server/miniapps/bootstrap.js";
import { builtinMiniAppMeta, builtinMiniAppVersion } from "$lib/server/miniapps/builtinPackage.js";
import { BUILTIN_MINI_APP_IDS } from "$lib/server/miniapps/registry.js";
import { createMiniAppHost, type MiniAppEnablementEntry } from "$lib/server/miniapps/host.js";
import { invokeMessageAction } from "$lib/server/miniapps/messageActions.js";

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
  // No staging directory may survive a successful install. It is dot-prefixed
  // so that even mid-write, discovery skips it instead of reporting a broken app.
  assert.equal(existsSync(join(codeRoot, ".todo.installing")), false);
  assert.equal(existsSync(join(codeRoot, "todo.installing")), false);
});

test("bootstrap never overwrites an owner's own copy of a built-in", () => {
  const { codeRoot } = makeRoots();
  mkdirSync(join(codeRoot, "todo"), { recursive: true });
  writeFileSync(join(codeRoot, "todo", "manifest.json"), "{\"mine\":true}", "utf8");

  const result = ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });

  assert.deepEqual(result.installed, []);
  // Asserted per app rather than over the whole array: every built-in this
  // build ships reports a reason here, and shipping one more must not fail a
  // test about Todo.
  assert.deepEqual(result.skipped.find((row) => row.id === "todo"), {
    id: "todo",
    reason: "already-installed"
  });
  assert.equal(readFileSync(join(codeRoot, "todo", "manifest.json"), "utf8"), "{\"mine\":true}");
});

test("an uninstalled built-in is not silently reinstalled on the next start", () => {
  const { codeRoot } = makeRoots();
  const result = ensureBuiltinMiniApps({
    codeRoot,
    getEnablement: () => ({ todo: { enabled: false, removedBuiltin: true } })
  });

  assert.deepEqual(result.installed, []);
  assert.deepEqual(result.skipped.find((row) => row.id === "todo"), {
    id: "todo",
    reason: "removed-by-owner"
  });
  assert.equal(existsSync(join(codeRoot, "todo")), false);
});

test("the bootstrapped Todo app loads and exposes the tools its manifest declares", () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});

  const entry = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(entry?.status, "active", entry?.error);
  assert.equal(entry?.builtin, true);
  // Asserted against the shipped manifest rather than a copy of the tool list:
  // the host's own load check already proves manifest and handlers correspond,
  // and hard-coding the names here only breaks every time the app grows one.
  const declared = (JSON.parse(manifestSource) as { tools: Array<{ name: string }> }).tools;
  assert.deepEqual(entry?.toolNames, declared.map((tool) => tool.name));
  assert.ok(["add", "list", "complete", "remove"].every((name) => entry?.toolNames.includes(name)));
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

test("Todo's contributed message action stores the selected text as a todo", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const host = hostOver(codeRoot, dataRoot, {});

  await invokeMessageAction(host, {
    appId: "todo",
    tool: "add",
    capture: {
      text: "long assistant answer",
      selection: "buy milk",
      role: "assistant"
    }
  }, { channel: "desktop" });

  const listed = await host.invokeTool("miniapp__todo__list", { status: "all" }, { toolCallId: "list" });
  assert.deepEqual((listed.structuredContent as any[]).map((row) => row.title), ["buy milk"]);
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

test("updating the built-in restores the shipped code and keeps the owner's todos", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const enablement: Record<string, MiniAppEnablementEntry> = {};
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete enablement[appId];
      else enablement[appId] = entry;
    },
    builtinAppIds: ["todo"],
    getBuiltinApp: getBuiltinMiniApp
  });
  await host.invokeTool("miniapp__todo__add", { title: "survive the update" }, { toolCallId: "t1" });

  // Stand in for an older install: an owner on the previous version, whose copy
  // is also missing a file the new build ships.
  const stale = JSON.parse(readFileSync(join(codeRoot, "todo", "manifest.json"), "utf8"));
  stale.version = "0.9.0";
  writeFileSync(join(codeRoot, "todo", "manifest.json"), JSON.stringify(stale), "utf8");
  rmSync(join(codeRoot, "todo", "ui", "styles.css"));
  host.refresh();

  const shipped = builtinMiniAppVersion(getBuiltinMiniApp("todo")!);
  const before = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(before?.updateAvailable, true);
  assert.equal(before?.availableVersion, shipped);

  await host.updateBuiltin("todo");

  const after = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(after?.version, shipped);
  assert.equal(after?.updateAvailable, false);
  assert.equal(after?.status, "active", after?.error);
  assert.ok(existsSync(join(codeRoot, "todo", "ui", "styles.css")), "the missing file is restored");

  const listed = await host.invokeTool("miniapp__todo__list", { status: "all" }, { toolCallId: "t2" });
  assert.deepEqual((listed.structuredContent as any[]).map((row) => row.title), ["survive the update"]);
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

/**
 * The built-in catalog — what the manager's Built-in tab is built on.
 *
 * The invariant under test is that a built-in is an *offer*: it may be listed
 * without being installed, installed on request, uninstalled, and installed
 * again. A built-in that can only be described once it exists on disk is one
 * the owner can never get back after removing it.
 */

function builtinHostOver(
  codeRoot: string,
  dataRoot: string,
  enablement: Record<string, MiniAppEnablementEntry>
) {
  return createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete enablement[appId];
      else enablement[appId] = entry;
    },
    builtinAppIds: builtinMiniAppIds(),
    getBuiltinApp: getBuiltinMiniApp
  });
}

test("the built-in ids the host labels are the ids the bundle actually ships", () => {
  // One hand-written list is how an app ends up shipped but not labelled
  // built-in: no update offered, no bundled reinstall, wrong provenance.
  assert.deepEqual([...BUILTIN_MINI_APP_IDS], builtinMiniAppIds());
  assert.deepEqual(builtinMiniAppIds(), listBuiltinMiniApps().map((app) => app.id));
  assert.ok(builtinMiniAppIds().includes("note"), "Note ships as a built-in");
  assert.ok(builtinMiniAppIds().includes("todo"), "Todo ships as a built-in");
  assert.ok(builtinMiniAppIds().includes("mini-chat"), "Mini Chat ships as a built-in");
  assert.ok(builtinMiniAppIds().includes("md-preview"), "MD Preview ships as a built-in");
});

test("a built-in without autoInstall is offered rather than planted in the workspace", () => {
  const { codeRoot, dataRoot } = makeRoots();
  const result = ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });

  assert.deepEqual(result.skipped.find((row) => row.id === "note"), { id: "note", reason: "opt-in" });
  assert.deepEqual(result.skipped.find((row) => row.id === "mini-chat"), { id: "mini-chat", reason: "opt-in" });
  assert.equal(existsSync(join(codeRoot, "note")), false, "an upgrade must not plant a new app");

  // Not installed, yet fully describable: name, description, version and icon
  // come from the bundled copy, which is what makes the row installable.
  const host = builtinHostOver(codeRoot, dataRoot, {});
  const note = host.listBuiltinCatalog().find((row) => row.id === "note");
  assert.equal(note?.installed, false);
  assert.equal(note?.status, "not-installed");
  assert.equal(note?.installedVersion, "");
  assert.equal(note?.updateAvailable, false, "there is nothing installed to update");
  assert.equal(note?.availableVersion, builtinMiniAppVersion(getBuiltinMiniApp("note")!));
  assert.equal(note?.name, builtinMiniAppMeta(getBuiltinMiniApp("note")!).name);
  assert.ok(note?.iconDataUri.startsWith("data:image/svg+xml;base64,"), "the row can show an icon");
  assert.ok((note?.toolNames.length ?? 0) > 0, "the row can say what the app contributes");

  const miniChat = host.listBuiltinCatalog().find((row) => row.id === "mini-chat");
  assert.equal(miniChat?.name, "Mini Chat");
  assert.equal(miniChat?.installed, false);
  assert.deepEqual(miniChat?.toolNames, [], "UI-only Mini Chat does not expose Agent tools");

  // The installed catalog stays a list of what is installed.
  assert.deepEqual(host.listCatalog().map((row) => row.id), ["todo"]);
});

test("installing a built-in writes the shipped copy and the app loads", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  const enablement: Record<string, MiniAppEnablementEntry> = {};
  const host = builtinHostOver(codeRoot, dataRoot, enablement);

  await host.installBuiltin("note");

  const note = host.listBuiltinCatalog().find((row) => row.id === "note");
  assert.equal(note?.installed, true);
  assert.equal(note?.enabled, true);
  assert.equal(note?.status, "active", note?.error);
  assert.equal(note?.updateAvailable, false, "the copy just written is the shipped one");
  assert.equal(note?.installedVersion, note?.availableVersion);
  assert.equal(
    host.listCatalog().find((row) => row.id === "note")?.source.kind,
    "builtin",
    "provenance says where it came from"
  );

  // The point of a built-in is that it works after one click, so the runtime
  // must actually load — a manifest that lists a handler the code lacks is a
  // failure this test has to catch, not the owner.
  await host.smokeTest("note");
});

test("a built-in the owner uninstalled can be installed again, tombstone and all", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const enablement: Record<string, MiniAppEnablementEntry> = {};
  const host = builtinHostOver(codeRoot, dataRoot, enablement);

  await host.uninstall("todo", { deleteData: false });
  assert.equal(enablement.todo?.removedBuiltin, true, "uninstall records the owner's intent");
  const removed = host.listBuiltinCatalog().find((row) => row.id === "todo");
  assert.equal(removed?.installed, false);
  assert.equal(removed?.removedByOwner, true, "the row says why it is gone");

  await host.installBuiltin("todo");

  const restored = host.listBuiltinCatalog().find((row) => row.id === "todo");
  assert.equal(restored?.installed, true);
  assert.equal(restored?.enabled, true);
  assert.equal(restored?.status, "active", restored?.error);
  // The tombstone must be cleared, or the next start deletes what the owner
  // just asked for — the failure would only show up after a restart.
  assert.notEqual(enablement.todo?.removedBuiltin, true);
  assert.deepEqual(
    ensureBuiltinMiniApps({ codeRoot, getEnablement: () => enablement }).skipped.find((row) => row.id === "todo"),
    { id: "todo", reason: "already-installed" }
  );
});

test("installing a built-in over a stale copy updates it and keeps the owner's data", async () => {
  const { codeRoot, dataRoot } = makeRoots();
  ensureBuiltinMiniApps({ codeRoot, getEnablement: () => ({}) });
  const enablement: Record<string, MiniAppEnablementEntry> = { todo: { enabled: false } };
  const host = builtinHostOver(codeRoot, dataRoot, enablement);

  const stale = JSON.parse(readFileSync(join(codeRoot, "todo", "manifest.json"), "utf8"));
  stale.version = "0.0.1";
  writeFileSync(join(codeRoot, "todo", "manifest.json"), JSON.stringify(stale), "utf8");
  host.refresh();

  const before = host.listBuiltinCatalog().find((row) => row.id === "todo");
  assert.equal(before?.installed, true);
  assert.equal(before?.installedVersion, "0.0.1");
  assert.equal(before?.updateAvailable, true, "an older installed copy is offered an update");

  await host.installBuiltin("todo");

  const after = host.listBuiltinCatalog().find((row) => row.id === "todo");
  assert.equal(after?.installedVersion, builtinMiniAppVersion(getBuiltinMiniApp("todo")!));
  assert.equal(after?.updateAvailable, false);
  // An owner who switched the app off gets the new code, still switched off.
  assert.equal(enablement.todo?.enabled, false);
  assert.equal(after?.enabled, false);
});

test("every built-in this build ships loads with the tools its manifest declares", async () => {
  // Generic on purpose: adding a built-in must not require remembering to add
  // a test, and "it appears in the catalog" is not the same as "it runs".
  for (const app of listBuiltinMiniApps()) {
    const { codeRoot, dataRoot } = makeRoots();
    const host = builtinHostOver(codeRoot, dataRoot, {});
    await host.installBuiltin(app.id);

    const entry = host.listCatalog().find((row) => row.id === app.id);
    assert.equal(entry?.status, "active", `${app.id}: ${entry?.error ?? "not installed"}`);
    assert.deepEqual(entry?.toolNames, builtinMiniAppMeta(app).toolNames, `${app.id} tool names`);
    await host.smokeTest(app.id);
  }
});

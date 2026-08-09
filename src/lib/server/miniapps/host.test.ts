import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createMiniAppHost,
  type MiniAppEnablementEntry,
  type MiniAppHost,
  type MiniAppHostOptions
} from "$lib/server/miniapps/host.js";
import { MiniAppError, type MiniAppRuntime } from "$lib/server/miniapps/types.js";

/**
 * MiniAppHost behaviour tests.
 *
 * These assert externally observable behaviour only: what lands in the catalog,
 * what a tool call persists, when a call is refused. Loading order, caches and
 * path resolution are implementation details and are never asserted directly —
 * they are covered through the behaviour they produce (one runtime for
 * concurrent first calls, a refused call after disable, an error row instead of
 * a silent skip).
 *
 * Every test runs against a temporary directory; none of them touch ~/.molibot.
 */

interface Fixture {
  root: string;
  codeRoot: string;
  dataRoot: string;
  enablement: Record<string, MiniAppEnablementEntry>;
}

const activeHosts = new Set<MiniAppHost>();
test.afterEach(async () => {
  await Promise.all([...activeHosts].map((host) => host.dispose()));
  activeHosts.clear();
});

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-"));
  const codeRoot = join(root, "miniapps", "apps");
  const dataRoot = join(root, "miniapps", "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  return { root, codeRoot, dataRoot, enablement: {} };
}

function hostFor(fixture: Fixture, overrides: Partial<MiniAppHostOptions> = {}): MiniAppHost {
  const host = createMiniAppHost({
    codeRoot: fixture.codeRoot,
    dataRoot: fixture.dataRoot,
    getEnablement: () => fixture.enablement,
    setEnablement: (appId: string, entry: MiniAppEnablementEntry | null) => {
      if (entry === null) delete fixture.enablement[appId];
      else fixture.enablement[appId] = entry;
    },
    ...overrides
  });
  activeHosts.add(host);
  return host;
}

function baseManifest(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id,
    name: `${id} app`,
    version: "1.0.0",
    description: "Fixture app.",
    engines: { molibot: ">=0.0.1" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    tools: [
      {
        name: "add",
        title: "Add note",
        description: "Append one note to the app's store.",
        keywords: ["note", "笔记"],
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", minLength: 1 } },
          required: ["text"],
          additionalProperties: false
        },
        readOnlyHint: false,
        destructiveHint: false
      },
      {
        name: "list",
        description: "List every stored note.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        readOnlyHint: true,
        destructiveHint: false
      }
    ],
    ...overrides
  };
}

/**
 * A minimal but real app: tool handlers and the HTTP handler both go through
 * one `notes` array, which is the whole point of the platform.
 */
const APP_SOURCE = `import fs from "node:fs";
import path from "node:path";

export default function create(context) {
  const file = path.join(context.dataDir, "notes.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const write = (rows) => fs.writeFileSync(file, JSON.stringify(rows), "utf8");
  const add = (text) => { const rows = read(); rows.push({ id: String(rows.length + 1), text }); write(rows); return rows; };

  return {
    tools: {
      add: async (input) => ({ content: [{ type: "text", text: "added" }], structuredContent: add(input.text), changed: true }),
      list: async () => ({ content: [{ type: "text", text: JSON.stringify(read()) }], structuredContent: read() })
    },
    async handleHttp(request) {
      if (request.path === "/notes" && request.method === "GET") return { body: { notes: read() } };
      if (request.path === "/notes" && request.method === "POST") return { status: 201, body: { notes: add(request.body.text) }, changed: true };
      if (request.path === "/leak") return { body: { dataDir: context.dataDir } };
      return { status: 404, body: { error: "not found" } };
    }
  };
}
`;

function installApp(
  fixture: Fixture,
  id: string,
  options: { manifest?: unknown; source?: string; skipUi?: boolean } = {}
): void {
  const appDir = join(fixture.codeRoot, id);
  mkdirSync(join(appDir, "server"), { recursive: true });
  if (!options.skipUi) {
    mkdirSync(join(appDir, "ui"), { recursive: true });
    writeFileSync(join(appDir, "ui", "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    writeFileSync(join(appDir, "ui", "app.js"), "console.log('fixture');", "utf8");
  }
  writeFileSync(join(appDir, "server", "index.mjs"), options.source ?? APP_SOURCE, "utf8");
  const manifest = options.manifest === undefined ? baseManifest(id) : options.manifest;
  writeFileSync(
    join(appDir, "manifest.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

test("a valid app enters the catalog with its manifest identity and tools", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  const catalog = host.listCatalog();
  assert.equal(catalog.length, 1);
  assert.deepEqual(
    { id: catalog[0].id, name: catalog[0].name, version: catalog[0].version, status: catalog[0].status, enabled: catalog[0].enabled },
    { id: "notes", name: "notes app", version: "1.0.0", status: "active", enabled: true }
  );
  assert.deepEqual(catalog[0].toolNames, ["add", "list"]);
  assert.equal(catalog[0].error, undefined);
});

test("an orphan data directory produces no catalog entry", () => {
  const fixture = makeFixture();
  mkdirSync(join(fixture.dataRoot, "ghost"), { recursive: true });
  const host = hostFor(fixture);
  assert.deepEqual(host.listCatalog(), []);
});

test("non-app clutter in the code root never reaches the catalog", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  // Everything a person can plausibly leave next to their apps: an archive, a
  // loose file, a scratch folder, a folder with an app-illegal name, and a
  // manifest-less tree that merely looks like one.
  writeFileSync(join(fixture.codeRoot, "notes-1.2.0.zip"), "PK", "utf8");
  writeFileSync(join(fixture.codeRoot, "README.md"), "# apps", "utf8");
  mkdirSync(join(fixture.codeRoot, "Downloads_v2"), { recursive: true });
  mkdirSync(join(fixture.codeRoot, "scratch", "server"), { recursive: true });
  writeFileSync(join(fixture.codeRoot, "scratch", "server", "index.mjs"), "export default () => ({});", "utf8");

  const host = hostFor(fixture);
  assert.deepEqual(host.listCatalog().map((entry) => entry.id), ["notes"]);
});

test("a missing code root yields an empty catalog rather than an error", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-empty-"));
  const host = hostFor({
    root,
    codeRoot: join(root, "miniapps", "apps"),
    dataRoot: join(root, "miniapps", "data"),
    enablement: {}
  });
  assert.deepEqual(host.listCatalog(), []);
});

test("broken manifests become error entries instead of being skipped", () => {
  const fixture = makeFixture();
  installApp(fixture, "badjson", { manifest: "{ not json" });
  installApp(fixture, "mismatch", { manifest: baseManifest("something-else") });
  installApp(fixture, "unknownfield", { manifest: { ...baseManifest("unknownfield"), surprise: true } });
  installApp(fixture, "badengine", { manifest: baseManifest("badengine", { engines: { molibot: ">=999.0.0" } }) });
  installApp(fixture, "badtool", {
    manifest: baseManifest("badtool", {
      tools: [{
        name: "boom",
        description: "both hints set",
        inputSchema: { type: "object" },
        readOnlyHint: true,
        destructiveHint: true
      }]
    })
  });

  const host = hostFor(fixture);
  const byId = new Map(host.listCatalog().map((entry) => [entry.id, entry]));

  for (const id of ["badjson", "mismatch", "unknownfield", "badengine", "badtool"]) {
    assert.equal(byId.get(id)?.status, "error", `${id} should be an error entry`);
    assert.ok((byId.get(id)?.error ?? "").length > 0, `${id} should carry a reason`);
  }
  assert.match(byId.get("mismatch")!.error!, /does not match directory name/);
  assert.match(byId.get("unknownfield")!.error!, /Unknown manifest field/);
  assert.match(byId.get("badengine")!.error!, /Requires Molibot/);
});

test("an entry escaping the app directory is rejected", () => {
  const fixture = makeFixture();
  installApp(fixture, "escaper", {
    manifest: baseManifest("escaper", { runtime: { entry: "../../evil.mjs" } })
  });
  writeFileSync(join(fixture.root, "evil.mjs"), "export default () => ({ tools: {} });", "utf8");

  const host = hostFor(fixture);
  const entry = host.listCatalog().find((row) => row.id === "escaper");
  assert.equal(entry?.status, "error");
  assert.match(entry!.error!, /escapes the app directory|missing/);
});

test("a symlinked entry pointing outside the app directory is rejected", () => {
  const fixture = makeFixture();
  installApp(fixture, "linky");
  const outside = join(fixture.root, "outside.mjs");
  writeFileSync(outside, "export default () => ({ tools: {}, async handleHttp() { return {}; } });", "utf8");
  rmSync(join(fixture.codeRoot, "linky", "server", "index.mjs"));
  symlinkSync(outside, join(fixture.codeRoot, "linky", "server", "index.mjs"));

  const host = hostFor(fixture);
  const entry = host.listCatalog().find((row) => row.id === "linky");
  assert.equal(entry?.status, "error");
});

test("listTools exposes collision-proof ids, readable labels and manifest hints", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  const tools = host.listTools();
  assert.deepEqual(tools.map((tool) => tool.toolId), ["miniapp__notes__add", "miniapp__notes__list"]);
  assert.deepEqual(tools.map((tool) => tool.label), ["notes.add", "notes.list"]);
  assert.equal(tools[1].readOnlyHint, true);
  assert.ok(tools[0].keywords.includes("笔记"), "manifest keywords reach the search index");
  assert.ok(tools[0].keywords.includes("notes"), "the app id is searchable");
});

test("a tool call persists into the app's own data directory", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  const result = await host.invokeTool("miniapp__notes__add", { text: "buy milk" }, { toolCallId: "t1" });
  assert.equal(result.changed, true);

  const stored = JSON.parse(readFileSync(join(fixture.dataRoot, "notes", "notes.json"), "utf8"));
  assert.deepEqual(stored, [{ id: "1", text: "buy milk" }]);
  assert.equal(host.getRevision("notes"), 1);
});

test("input that violates the manifest schema never reaches the handler", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  await assert.rejects(
    () => host.invokeTool("miniapp__notes__add", { text: "" }, { toolCallId: "t1" }),
    (error: unknown) => error instanceof MiniAppError && error.code === "invalid_input"
  );
  await assert.rejects(
    () => host.invokeTool("miniapp__notes__add", { wrong: "field" }, { toolCallId: "t2" }),
    (error: unknown) => error instanceof MiniAppError && error.code === "invalid_input"
  );
  assert.equal(existsSync(join(fixture.dataRoot, "notes", "notes.json")), false);
});

test("disabling an app refuses tool calls at invoke time, not just in the list", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  // Prove the tool was live first, so the refusal below is about enablement.
  await host.invokeTool("miniapp__notes__add", { text: "before" }, { toolCallId: "t1" });

  host.setEnabled("notes", false);
  assert.deepEqual(host.listTools(), []);
  await assert.rejects(
    () => host.invokeTool("miniapp__notes__add", { text: "after" }, { toolCallId: "t2" }),
    (error: unknown) => error instanceof MiniAppError && error.code === "disabled"
  );

  host.setEnabled("notes", true);
  await host.invokeTool("miniapp__notes__add", { text: "again" }, { toolCallId: "t3" });
  const stored = JSON.parse(readFileSync(join(fixture.dataRoot, "notes", "notes.json"), "utf8"));
  assert.deepEqual(stored.map((row: any) => row.text), ["before", "again"]);
});

test("concurrent first calls share one runtime instance", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  let factoryCalls = 0;
  const host = hostFor(fixture, {
    importModule: async (entryPath: string) => {
      const loaded = await import(`file://${entryPath}`);
      return {
        default: async (context: unknown) => {
          factoryCalls += 1;
          // A slow factory is what turns a missing shared promise into two
          // runtimes; without the delay the race would not reproduce.
          await new Promise((resolve) => setTimeout(resolve, 25));
          return loaded.default(context) as MiniAppRuntime;
        }
      };
    }
  });

  await Promise.all([
    host.invokeTool("miniapp__notes__add", { text: "a" }, { toolCallId: "t1" }),
    host.invokeTool("miniapp__notes__add", { text: "b" }, { toolCallId: "t2" }),
    host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t3" })
  ]);

  assert.equal(factoryCalls, 1);
});

test("a newly installed app activates immediately in the existing host", async () => {
  const fixture = makeFixture();
  const host = hostFor(fixture);

  installApp(fixture, "notes");
  await host.activateInstalled("notes");

  const result = await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t1" });
  assert.deepEqual(result.structuredContent, []);
  assert.equal(host.listCatalog().find((row) => row.id === "notes")?.status, "active");
});

test("same-version replacement disposes the loaded runtime and activates the new one", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  let generation = 0;
  let disposed = 0;
  const host = hostFor(fixture, {
    importModule: async () => {
      generation += 1;
      const label = generation === 1 ? "old" : "new";
      return {
        default: () => ({
          tools: {
            add: async () => ({ content: [{ type: "text", text: label }] }),
            list: async () => ({ content: [{ type: "text", text: label }] })
          },
          async handleHttp() { return { body: { label } }; },
          async dispose() { disposed += 1; }
        })
      };
    }
  });

  const before = await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t1" });
  assert.equal(before.content[0]?.text, "old");

  installApp(fixture, "notes");
  await host.activateInstalled("notes");
  const after = await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t2" });

  assert.equal(disposed, 1);
  assert.equal(after.content[0]?.text, "new");
  assert.equal(generation, 2);
});

test("activation waits for a first tool call that is still loading its runtime", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  let releaseFirstLoad!: () => void;
  let reportFirstLoad!: () => void;
  const firstLoad = new Promise<void>((resolve) => { releaseFirstLoad = resolve; });
  const firstLoadStarted = new Promise<void>((resolve) => { reportFirstLoad = resolve; });
  let generation = 0;
  let disposed = 0;
  const host = hostFor(fixture, {
    importModule: async () => {
      generation += 1;
      const current = generation;
      if (current === 1) {
        reportFirstLoad();
        await firstLoad;
      }
      return {
        default: () => ({
          tools: {
            add: async () => ({ content: [] }),
            list: async () => ({ content: [{ type: "text", text: current === 1 ? "old" : "new" }] })
          },
          async handleHttp() { return { body: null }; },
          async dispose() { disposed += 1; }
        })
      };
    }
  });

  const oldCall = host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t1" });
  await firstLoadStarted;
  installApp(fixture, "notes");
  let activated = false;
  const activation = host.activateInstalled("notes").then(() => { activated = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(activated, false, "replacement must not pass a call still loading the old runtime");

  releaseFirstLoad();
  assert.equal((await oldCall).content[0]?.text, "old");
  await activation;
  assert.equal(disposed, 1);
  assert.equal((await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t2" })).content[0]?.text, "new");
});

test("a failing runtime load turns the app into an error entry", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: "export default () => { throw new Error('boom'); };" });
  const host = hostFor(fixture);

  await assert.rejects(() => host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t1" }));
  const entry = host.listCatalog().find((row) => row.id === "notes");
  assert.equal(entry?.status, "error");
  assert.ok(entry?.error);
});

test("handlers that do not match the manifest fail the load", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", {
    source: `export default () => ({
      tools: { add: async () => ({ content: [] }) },
      async handleHttp() { return {}; }
    });`
  });
  const host = hostFor(fixture);

  await assert.rejects(
    () => host.invokeTool("miniapp__notes__add", { text: "x" }, { toolCallId: "t1" }),
    /Missing: list/
  );
});

test("a mismatched data schemaVersion lets the app start and updates the recorded version", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  mkdirSync(join(fixture.dataRoot, "notes"), { recursive: true });
  writeFileSync(join(fixture.dataRoot, "notes", "_host.json"), JSON.stringify({ schemaVersion: 7 }), "utf8");

  const host = hostFor(fixture);
  // The app starts successfully — the host no longer blocks on schema mismatch.
  const result = await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t1" });
  assert.ok(result);

  // After successful startup, writeHostState records the manifest's schemaVersion.
  const hostState = JSON.parse(readFileSync(join(fixture.dataRoot, "notes", "_host.json"), "utf8"));
  assert.equal(hostState.schemaVersion, 1);
});

test("tool errors surface a stable message without host paths", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", {
    source: `export default (context) => ({
      tools: {
        add: async () => { throw new Error("failed reading " + context.dataDir + "/notes.json"); },
        list: async () => ({ content: [] })
      },
      async handleHttp() { return {}; }
    });`
  });
  const host = hostFor(fixture);

  await assert.rejects(
    () => host.invokeTool("miniapp__notes__add", { text: "x" }, { toolCallId: "t1" }),
    (error: unknown) => {
      assert.ok(error instanceof MiniAppError);
      assert.ok(!error.message.includes(fixture.dataRoot), `message leaked a host path: ${error.message}`);
      return true;
    }
  );
});

test("uninstall removes code, keeps data by default and can delete it on request", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  await host.invokeTool("miniapp__notes__add", { text: "keep me" }, { toolCallId: "t1" });

  await host.uninstall("notes", { deleteData: false });
  assert.equal(existsSync(join(fixture.codeRoot, "notes")), false);
  assert.equal(existsSync(join(fixture.dataRoot, "notes", "notes.json")), true);
  assert.deepEqual(host.listCatalog(), []);

  // Reinstalling the code must restore the previous history.
  installApp(fixture, "notes");
  host.refresh();
  const listed = await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t2" });
  assert.deepEqual(listed.structuredContent, [{ id: "1", text: "keep me" }]);

  await host.uninstall("notes", { deleteData: true });
  assert.equal(existsSync(join(fixture.dataRoot, "notes")), false);
});

/**
 * A bundled built-in package, as the host would receive it from `bootstrap.ts`.
 * The server source is a second, distinguishable build so an update can be
 * proven to have replaced the code and not merely rewritten the manifest.
 */
function bundledTodo(version: string): { id: string; files: Record<string, string> } {
  return {
    id: "todo",
    files: {
      "manifest.json": JSON.stringify(baseManifest("todo", { version })),
      "server/index.mjs": APP_SOURCE.replace("added", "added-by-bundle"),
      "ui/index.html": "<!doctype html><title>bundled</title>"
    }
  };
}

test("a newer bundled built-in is offered as an update; an older or equal one is not", () => {
  const fixture = makeFixture();
  installApp(fixture, "todo", { manifest: baseManifest("todo", { version: "1.0.0" }) });

  const offered = (bundledVersion: string) => hostFor(fixture, {
    builtinAppIds: ["todo"],
    getBuiltinApp: () => bundledTodo(bundledVersion)
  }).listCatalog().find((entry) => entry.id === "todo");

  assert.equal(offered("2.0.0")?.updateAvailable, true);
  assert.equal(offered("2.0.0")?.availableVersion, "2.0.0");
  assert.equal(offered("1.0.0")?.updateAvailable, false, "same version is not an update");
  assert.equal(offered("0.9.0")?.updateAvailable, false, "an older bundle must not offer a downgrade");

  // An app with no bundled copy — anything the owner installed themselves —
  // can never advertise an update, because there is nothing to update it to.
  installApp(fixture, "notes");
  const external = hostFor(fixture, { getBuiltinApp: () => null })
    .listCatalog().find((entry) => entry.id === "notes");
  assert.equal(external?.updateAvailable, false);
  assert.equal(external?.availableVersion, "");
});

test("updating a built-in replaces its code, keeps its data and keeps it disabled if it was", async () => {
  const fixture = makeFixture();
  installApp(fixture, "todo", { manifest: baseManifest("todo", { version: "1.0.0" }) });
  const host = hostFor(fixture, {
    builtinAppIds: ["todo"],
    getBuiltinApp: () => bundledTodo("2.0.0")
  });

  await host.invokeTool("miniapp__todo__add", { text: "keep me" }, { toolCallId: "t1" });
  host.setEnabled("todo", false);

  await host.updateBuiltin("todo");

  const entry = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(entry?.version, "2.0.0");
  assert.equal(entry?.updateAvailable, false, "the offer must clear once applied");
  // The old build's extra file is gone: an update is a full replacement of the
  // code directory, not a merge over whatever was there.
  assert.equal(existsSync(join(fixture.codeRoot, "todo", "ui", "app.js")), false);
  assert.match(readFileSync(join(fixture.codeRoot, "todo", "server", "index.mjs"), "utf8"), /added-by-bundle/);

  // Data survives, and enablement is not silently flipped back on.
  assert.equal(existsSync(join(fixture.dataRoot, "todo", "notes.json")), true);
  assert.equal(fixture.enablement.todo?.enabled, false);

  host.setEnabled("todo", true);
  const listed = await host.invokeTool("miniapp__todo__list", {}, { toolCallId: "t2" });
  assert.deepEqual(listed.structuredContent, [{ id: "1", text: "keep me" }]);
});

test("a broken built-in can be repaired by updating, and no staging directory is left behind", async () => {
  const fixture = makeFixture();
  installApp(fixture, "todo", { manifest: "{ not json" });
  const host = hostFor(fixture, {
    builtinAppIds: ["todo"],
    getBuiltinApp: () => bundledTodo("1.0.0")
  });

  // "unknown" versus a real bundled version is a difference neither side can
  // compare with semver, so the shipped copy is offered as the repair.
  assert.equal(host.listCatalog().find((row) => row.id === "todo")?.updateAvailable, true);

  await host.updateBuiltin("todo");
  const entry = host.listCatalog().find((row) => row.id === "todo");
  assert.equal(entry?.status, "active");
  assert.equal(entry?.error, undefined);
  assert.deepEqual(
    readdirSync(fixture.codeRoot).filter((name) => name !== ".runtime").sort(),
    ["todo"]
  );
});

test("updating refuses for an app that is not a bundled built-in", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture, { getBuiltinApp: () => null });

  await assert.rejects(() => host.updateBuiltin("notes"), /not a built-in/);
  await assert.rejects(() => host.updateBuiltin("ghost"), /Unknown Mini App/);
});

test("uninstalling a built-in leaves a tombstone so it is not reinstalled", async () => {
  const fixture = makeFixture();
  installApp(fixture, "todo");
  const host = hostFor(fixture, { builtinAppIds: ["todo"] });

  await host.uninstall("todo", { deleteData: false });
  assert.deepEqual(fixture.enablement.todo, { enabled: false, removedBuiltin: true });
});

test("uninstalling an external app clears its enablement record", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  host.setEnabled("notes", false);
  assert.ok(fixture.enablement.notes);

  await host.uninstall("notes", { deleteData: false });
  assert.equal(fixture.enablement.notes, undefined);
});

test("uninstall refuses while a call is in flight and deletes nothing", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", {
    source: `export default () => ({
      tools: {
        add: async () => new Promise(() => {}),
        list: async () => ({ content: [] })
      },
      async handleHttp() { return {}; }
    });`
  });
  const host = hostFor(fixture);

  const pending = host.invokeTool("miniapp__notes__add", { text: "stuck" }, { toolCallId: "t1" });
  void pending.catch(() => undefined);
  // Let the runtime load and the handler start before asking for the uninstall.
  await new Promise((resolve) => setTimeout(resolve, 50));

  await assert.rejects(
    () => host.uninstall("notes", { deleteData: true }),
    (error: unknown) => error instanceof MiniAppError && error.code === "busy"
  );
  assert.equal(existsSync(join(fixture.codeRoot, "notes")), true);
  assert.equal(existsSync(join(fixture.dataRoot, "notes")), true);
});

test("UI assets resolve inside ui/ and path escapes are refused", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  writeFileSync(join(fixture.root, "secret.txt"), "top secret", "utf8");
  const host = hostFor(fixture);

  assert.equal(host.resolveUiAsset("notes", "").contentType, "text/html; charset=utf-8");
  assert.equal(host.resolveUiAsset("notes", "app.js").contentType, "text/javascript; charset=utf-8");

  for (const attempt of ["../manifest.json", "../../secret.txt", "..%2f..%2fsecret.txt", "%2e%2e%2fmanifest.json", "/etc/passwd", ".hidden"]) {
    assert.throws(
      () => host.resolveUiAsset("notes", attempt),
      (error: unknown) => error instanceof MiniAppError,
      `"${attempt}" must be refused`
    );
  }
});

test("a disabled app refuses UI assets too", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  host.setEnabled("notes", false);

  assert.throws(
    () => host.resolveUiAsset("notes", ""),
    (error: unknown) => error instanceof MiniAppError && error.code === "disabled"
  );
});

test("a fresh host reads the persisted disabled state", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  hostFor(fixture).setEnabled("notes", false);

  // Same enablement object, new host: the toggle came from settings, not memory.
  const restarted = hostFor(fixture);
  assert.equal(restarted.listCatalog()[0].status, "disabled");
  assert.deepEqual(restarted.listTools(), []);
});

test("a declared icon is inlined as a data URI, and a broken one is a visible error", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", {
    manifest: baseManifest("notes", { ui: { entry: "ui/index.html", icon: "ui/icon.svg" } })
  });
  writeFileSync(join(fixture.codeRoot, "notes", "ui", "icon.svg"), "<svg/>", "utf8");

  const entry = hostFor(fixture).listCatalog()[0];
  assert.match(entry.iconDataUri, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(entry.iconDataUri.split(",")[1], "base64").toString("utf8"), "<svg/>");

  // A declared-but-missing icon must not silently fall back to the default
  // glyph; the author needs to see that their path is wrong.
  const broken = makeFixture();
  installApp(broken, "notes", {
    manifest: baseManifest("notes", { ui: { entry: "ui/index.html", icon: "ui/nope.svg" } })
  });
  assert.equal(hostFor(broken).listCatalog()[0].status, "error");
});

test("an icon escaping the app directory or of an unsupported type is refused", () => {
  for (const icon of ["../../secret.svg", "ui/../../secret.svg", "ui/icon.exe", "ui/icon.html", "icon.svg"]) {
    const fixture = makeFixture();
    installApp(fixture, "notes", {
      manifest: baseManifest("notes", { ui: { entry: "ui/index.html", icon } })
    });
    writeFileSync(join(fixture.root, "secret.svg"), "<svg>secret</svg>", "utf8");
    const entry = hostFor(fixture).listCatalog()[0];
    assert.equal(entry.status, "error", `icon "${icon}" must be refused`);
    assert.equal(entry.iconDataUri, "");
  }
});

test("an app with no icon reports an empty data URI rather than failing", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  assert.equal(hostFor(fixture).listCatalog()[0].iconDataUri, "");
});

test("catalog entries report provenance, with built-ins labelled as such", () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  installApp(fixture, "todo");

  const host = hostFor(fixture, {
    builtinAppIds: ["todo"],
    getInstallSources: () => ({ notes: { kind: "github", repo: "someone/notes", ref: "v1.2.0" } })
  });
  const byId = new Map(host.listCatalog().map((entry) => [entry.id, entry]));

  assert.deepEqual(byId.get("todo")?.source, { kind: "builtin" });
  assert.deepEqual(byId.get("notes")?.source, { kind: "github", repo: "someone/notes", ref: "v1.2.0" });

  // A hand-placed app with no record is an unlabelled local directory, not a
  // built-in and not a remote source.
  const plain = hostFor(fixture);
  assert.deepEqual(
    plain.listCatalog().find((entry) => entry.id === "notes")?.source,
    { kind: "directory", label: "" }
  );
});

// --------------------------------------------------------- badges (§2.5)

/** An app that drives its own badge and returns a result card. */
const BADGE_CARD_SOURCE = `export default function create(context) {
  return {
    tools: {
      add: async (input) => {
        context.badge.set({ kind: "count", count: Number(input.text) });
        return {
          content: [{ type: "text", text: "added" }],
          changed: true,
          card: {
            title: "Saved",
            fields: [{ label: "Text", value: input.text }],
            icon: "star",
            link: "molibot://miniapp/notes/entry/1"
          }
        };
      },
      list: async () => {
        context.badge.clear();
        return { content: [{ type: "text", text: "cleared" }] };
      }
    },
    async handleHttp() { return { status: 404, body: {} }; }
  };
}
`;

test("an app can set a badge that reaches the catalog, and opening clears it", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: BADGE_CARD_SOURCE });
  const host = hostFor(fixture);

  assert.equal(host.listCatalog()[0].badge, null);

  await host.invokeTool("miniapp__notes__add", { text: "4" }, { toolCallId: "t1" });
  assert.deepEqual(host.listCatalog()[0].badge, { kind: "count", count: 4 });

  // The host clears on the owner's behalf when they open the panel.
  host.clearBadge("notes");
  assert.equal(host.listCatalog()[0].badge, null);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("an app can clear its own badge", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: BADGE_CARD_SOURCE });
  const host = hostFor(fixture);

  await host.invokeTool("miniapp__notes__add", { text: "2" }, { toolCallId: "t1" });
  await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t2" });
  assert.equal(host.listCatalog()[0].badge, null);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("a count is bounded, and a meaningless one clears rather than rendering", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: BADGE_CARD_SOURCE });
  const host = hostFor(fixture);

  await host.invokeTool("miniapp__notes__add", { text: "5000" }, { toolCallId: "t1" });
  assert.deepEqual(host.listCatalog()[0].badge, { kind: "count", count: 99 });

  // Counting down to nothing should end with no badge, not a "0" chip.
  await host.invokeTool("miniapp__notes__add", { text: "0" }, { toolCallId: "t2" });
  assert.equal(host.listCatalog()[0].badge, null);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("a disabled app stops advertising its badge", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: BADGE_CARD_SOURCE });
  const host = hostFor(fixture);

  await host.invokeTool("miniapp__notes__add", { text: "3" }, { toolCallId: "t1" });
  assert.deepEqual(host.listCatalog()[0].badge, { kind: "count", count: 3 });

  // The sidebar must not show a count for something the owner cannot open.
  fixture.enablement.notes = { enabled: false };
  assert.equal(host.listCatalog()[0].badge, null);

  rmSync(fixture.root, { recursive: true, force: true });
});

// ---------------------------------------------------- result cards (§2.3)

test("a tool result card is sanitized by the host before it leaves", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", { source: BADGE_CARD_SOURCE });
  const host = hostFor(fixture);

  const result = await host.invokeTool("miniapp__notes__add", { text: "hello" }, { toolCallId: "t1" });
  assert.deepEqual(result.card, {
    title: "Saved",
    fields: [{ label: "Text", value: "hello" }],
    icon: "star",
    link: "molibot://miniapp/notes/entry/1"
  });

  rmSync(fixture.root, { recursive: true, force: true });
});

test("a card linking to another app loses the link rather than the whole result", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes", {
    source: `export default function create() {
      return {
        tools: {
          add: async () => ({
            content: [{ type: "text", text: "ok" }],
            card: { title: "Saved", link: "molibot://miniapp/other/entry/1" }
          }),
          list: async () => ({ content: [] })
        },
        async handleHttp() { return { status: 404, body: {} }; }
      };
    }`
  });
  const host = hostFor(fixture);

  const result = await host.invokeTool("miniapp__notes__add", { text: "x" }, { toolCallId: "t1" });
  assert.equal(result.card?.title, "Saved");
  assert.equal(result.card?.link, undefined);
  // The text the model reads is untouched by card handling.
  assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("an app returning no card produces a result with no card key", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);

  const result = await host.invokeTool("miniapp__notes__add", { text: "x" }, { toolCallId: "t1" });
  assert.equal("card" in result, false);

  rmSync(fixture.root, { recursive: true, force: true });
});

// ------------------------------------------------ data file reads (§2.2)

test("readDataFile returns a file inside the app's own data directory", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  // Force the runtime to load so the data directory exists.
  await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t0" });

  const exportsDir = join(fixture.dataRoot, "notes", "exports");
  mkdirSync(exportsDir, { recursive: true });
  writeFileSync(join(exportsDir, "chart.png"), "PNGDATA", "utf8");

  const file = host.readDataFile("notes", "exports/chart.png", 1024);
  assert.equal(file.name, "chart.png");
  assert.equal(file.bytes.toString("utf8"), "PNGDATA");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("readDataFile refuses to escape the app's data directory", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t0" });

  // A sibling app's data is as off-limits as anything else on the host.
  mkdirSync(join(fixture.dataRoot, "other"), { recursive: true });
  writeFileSync(join(fixture.dataRoot, "other", "secret.txt"), "nope", "utf8");

  for (const relative of ["../other/secret.txt", "/etc/passwd", "missing.png"]) {
    assert.throws(
      () => host.readDataFile("notes", relative, 1024),
      MiniAppError,
      `expected ${relative} to be refused`
    );
  }

  rmSync(fixture.root, { recursive: true, force: true });
});

test("readDataFile refuses a symlink pointing outside the data directory", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t0" });

  const outside = join(fixture.root, "outside.txt");
  writeFileSync(outside, "secret", "utf8");
  // Containment is proven after following symlinks — the check a plain
  // join + startsWith would miss.
  symlinkSync(outside, join(fixture.dataRoot, "notes", "link.txt"));

  assert.throws(() => host.readDataFile("notes", "link.txt", 1024), MiniAppError);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("readDataFile enforces the size ceiling before returning bytes", async () => {
  const fixture = makeFixture();
  installApp(fixture, "notes");
  const host = hostFor(fixture);
  await host.invokeTool("miniapp__notes__list", {}, { toolCallId: "t0" });

  writeFileSync(join(fixture.dataRoot, "notes", "big.bin"), "x".repeat(2048), "utf8");
  assert.throws(() => host.readDataFile("notes", "big.bin", 1024), MiniAppError);

  rmSync(fixture.root, { recursive: true, force: true });
});

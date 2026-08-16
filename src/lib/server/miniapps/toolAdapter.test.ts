import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMiniAppHost, type MiniAppEnablementEntry } from "$lib/server/miniapps/host.js";
import { buildMiniAppDeferredTools } from "$lib/server/miniapps/toolAdapter.js";
import { getRuntimeToolClassification } from "$lib/server/agent/tools/toolClassification.js";
import { createToolSearchTool, type DeferredToolEntry } from "$lib/server/agent/tools/toolSearch.js";

/**
 * The Mini App -> Agent tool seam.
 *
 * What matters externally: the agent can *find* an installed app's tools by
 * domain keyword, calling one persists into the app's own data, risk and source
 * come from the manifest rather than the tool name, and switching the app off
 * refuses the call even when the tool is already loaded into the running turn.
 */

const APP_SOURCE = `import fs from "node:fs";
import path from "node:path";

export default function create(context) {
  const file = path.join(context.dataDir, "todos.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const write = (rows) => fs.writeFileSync(file, JSON.stringify(rows), "utf8");

  return {
    tools: {
      add: async (input) => {
        const rows = read();
        rows.push({ id: String(rows.length + 1), title: input.title });
        write(rows);
        return { content: [{ type: "text", text: "Added " + input.title }], structuredContent: rows, changed: true };
      },
      list: async () => ({ content: [{ type: "text", text: JSON.stringify(read()) }], structuredContent: read() }),
      remove: async (input) => {
        write(read().filter((row) => row.id !== input.id));
        return { content: [{ type: "text", text: "Removed" }], changed: true };
      }
    },
    async handleHttp() { return { body: { todos: read() } }; }
  };
}
`;

const MANIFEST = {
  manifestVersion: 1,
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  description: "Manage one shared todo list from chat and Desktop.",
  engines: { molibot: ">=0.0.1" },
  runtime: { entry: "server/index.mjs" },
  ui: { entry: "ui/index.html" },
  data: { schemaVersion: 1 },
  tools: [
    {
      name: "add",
      title: "Add Todo",
      description: "Add one item to the owner's shared todo list.",
      keywords: ["todo", "task", "待办", "任务"],
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", minLength: 1, maxLength: 300 } },
        required: ["title"],
        additionalProperties: false
      },
      readOnlyHint: false,
      destructiveHint: false
    },
    {
      name: "list",
      title: "List Todos",
      description: "List the owner's todo items.",
      keywords: ["todo", "list", "待办"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      readOnlyHint: true,
      destructiveHint: false
    },
    {
      name: "remove",
      title: "Delete Todo",
      description: "Permanently delete one todo item.",
      keywords: ["todo", "delete", "删除"],
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false
      },
      readOnlyHint: false,
      destructiveHint: true
    }
  ]
};

function makeHost() {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-tools-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  const appDir = join(codeRoot, "todo");
  mkdirSync(join(appDir, "server"), { recursive: true });
  mkdirSync(join(appDir, "ui"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify(MANIFEST), "utf8");
  writeFileSync(join(appDir, "server", "index.mjs"), APP_SOURCE, "utf8");
  writeFileSync(join(appDir, "ui", "index.html"), "<!doctype html>", "utf8");

  const enablement: Record<string, MiniAppEnablementEntry> = {};
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete enablement[appId];
      else enablement[appId] = entry;
    }
  });
  return { host, root, dataRoot };
}

/** Wires the deferred tools into a real toolSearch so the search path is real. */
function toolSearchOver(entries: DeferredToolEntry[]) {
  const loaded = new Set<string>();
  return {
    loaded,
    tool: createToolSearchTool({
      chatId: "test",
      getDeferredTools: () => entries,
      loadDeferredTools: (names) => {
        const added: string[] = [];
        for (const name of names) {
          if (entries.some((entry) => entry.name === name) && !loaded.has(name)) {
            loaded.add(name);
            added.push(name);
          }
        }
        return added;
      }
    })
  };
}

test("Mini App tools are registered under collision-proof ids with readable labels", () => {
  const { host } = makeHost();
  const tools = buildMiniAppDeferredTools(host);

  assert.deepEqual(tools.map((entry) => entry.name), [
    "miniapp__todo__add",
    "miniapp__todo__list",
    "miniapp__todo__remove"
  ]);
  assert.deepEqual(tools.map((entry) => entry.tool.label), ["todo.add", "todo.list", "todo.remove"]);
  // The `mcp__server__tool` namespace must stay disjoint.
  assert.ok(tools.every((entry) => !entry.name.startsWith("mcp__")));
});

test("toolSearch finds an installed Mini App by domain keyword and returns its full schema", async () => {
  const { host } = makeHost();
  const entries = buildMiniAppDeferredTools(host).map((entry) => ({
    name: entry.name,
    label: entry.label,
    description: entry.description,
    keywords: entry.keywords,
    tool: entry.tool
  }));
  const search = toolSearchOver(entries);

  const result = await search.tool.execute("t1", { query: "todo" }) as any;
  const text = result.content[0].text as string;
  assert.match(text, /miniapp__todo__add/);
  // The whole point of deferral: the schema arrives with the search result.
  assert.match(text, /"title"/);
  assert.ok(search.loaded.has("miniapp__todo__add"));

  const chinese = await search.tool.execute("t2", { query: "待办" }) as any;
  assert.match(chinese.content[0].text as string, /miniapp__todo__/);
});

test("risk and source come from manifest hints, never from the tool name", () => {
  const { host } = makeHost();
  const byId = new Map(buildMiniAppDeferredTools(host).map((entry) => [entry.name, entry.descriptor]));

  const classify = (toolId: string) => getRuntimeToolClassification(toolId, {
    miniApp: {
      readOnlyHint: byId.get(toolId)!.readOnlyHint,
      destructiveHint: byId.get(toolId)!.destructiveHint
    }
  });

  assert.deepEqual(classify("miniapp__todo__list"), {
    risk: "low",
    source: "plugin",
    effect: "installed_app",
    thirdPartyHint: "read_only"
  });
  assert.deepEqual(classify("miniapp__todo__add"), {
    risk: "medium",
    source: "plugin",
    effect: "installed_app",
    thirdPartyHint: "undeclared"
  });
  // destructiveHint is what reaches the approval broker, not the word "remove".
  assert.deepEqual(classify("miniapp__todo__remove"), {
    risk: "high",
    source: "plugin",
    effect: "installed_app",
    thirdPartyHint: "destructive"
  });

  // Without hints a Mini App tool is still plugin/medium — it must never fall
  // through to the builtin/low default.
  assert.deepEqual(
    getRuntimeToolClassification("miniapp__unknown__thing"),
    { risk: "medium", source: "plugin", effect: "installed_app", thirdPartyHint: "undeclared" }
  );
});

test("a tool call persists through the adapter and reports the app's revision", async () => {
  const { host } = makeHost();
  const [add, list] = buildMiniAppDeferredTools(host);

  const added = await add.tool.execute("t1", { title: "买牛奶" }) as any;
  assert.match(added.content[0].text as string, /买牛奶/);
  assert.equal(added.details.appId, "todo");
  assert.equal(added.details.revision, 1);

  const listed = await list.tool.execute("t2", {}) as any;
  assert.deepEqual(listed.details.structuredContent, [{ id: "1", title: "买牛奶" }]);
});

test("tool details never carry the app's data directory", async () => {
  const { host, dataRoot } = makeHost();
  const [add] = buildMiniAppDeferredTools(host);
  const result = await add.tool.execute("t1", { title: "x" }) as any;
  assert.equal(JSON.stringify(result.details).includes(dataRoot), false);
});

test("invalid input is rejected before the handler runs", async () => {
  const { host } = makeHost();
  const [add, list] = buildMiniAppDeferredTools(host);

  const rejected = await add.tool.execute("t1", { title: "" }) as any;
  assert.ok(rejected.error, "schema violation must produce a tool error");
  assert.match(rejected.error as string, /Invalid input/);

  const listed = await list.tool.execute("t2", {}) as any;
  assert.deepEqual(listed.details.structuredContent, []);
});

test("an already-loaded tool is still refused after the app is disabled", async () => {
  const { host } = makeHost();
  // Capture the tool while the app is on — this is exactly the state a turn is
  // in when the owner flips the switch mid-run.
  const [add] = buildMiniAppDeferredTools(host);
  await add.tool.execute("t1", { title: "before" });

  host.setEnabled("todo", false);
  const refused = await add.tool.execute("t2", { title: "after" }) as any;
  assert.match(refused.error as string, /disabled/);
});

test("a disabled app contributes no deferred tools", () => {
  const { host } = makeHost();
  host.setEnabled("todo", false);
  assert.deepEqual(buildMiniAppDeferredTools(host), []);
});

// ---------------------------------------------------------------------------
// fileParams staging seam

const DOC_APP_SOURCE = `import fs from "node:fs";
import path from "node:path";

export default function create(context) {
  return {
    tools: {
      render: async (input, ctx) => {
        const abs = path.join(context.dataDir, input.docPath);
        const text = fs.readFileSync(abs, "utf8");
        const staged = ctx.stagedFiles?.docPath?.[0];
        return {
          content: [{
            type: "text",
            text: [text, staged?.name ?? "?", String(staged?.path === input.docPath)].join("|")
          }]
        };
      }
    },
    async handleHttp() { return { body: {} }; }
  };
}
`;

const DOC_MANIFEST = {
  manifestVersion: 1,
  id: "docrender",
  name: "Doc Render",
  version: "1.0.0",
  description: "Render a staged document.",
  engines: { molibot: ">=0.0.1" },
  runtime: { entry: "server/index.mjs" },
  ui: { entry: "ui/index.html" },
  data: { schemaVersion: 1 },
  tools: [{
    name: "render",
    description: "Render one markdown document from a file path.",
    keywords: ["render", "渲染"],
    inputSchema: {
      type: "object",
      properties: { docPath: { type: "string", minLength: 1 } },
      required: ["docPath"],
      additionalProperties: false
    },
    readOnlyHint: false,
    destructiveHint: false,
    fileParams: [{ param: "docPath", accepts: ["file"] }]
  }]
};

function makeDocHost() {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-docstage-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "appdata");
  const scratch = join(root, "scratch");
  const appDir = join(codeRoot, "docrender");
  mkdirSync(join(appDir, "server"), { recursive: true });
  mkdirSync(join(appDir, "ui"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify(DOC_MANIFEST), "utf-8");
  writeFileSync(join(appDir, "server", "index.mjs"), DOC_APP_SOURCE, "utf-8");
  writeFileSync(join(appDir, "ui", "index.html"), "<!doctype html>", "utf-8");
  writeFileSync(join(scratch, "draft.md"), "# staged body", "utf-8");

  const enablement: Record<string, MiniAppEnablementEntry> = {};
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete enablement[appId];
      else enablement[appId] = entry;
    }
  });
  return { host, root, scratch, dataRoot };
}

test("an agent tool call stages a file param through the subprocess boundary", async () => {
  const { host, scratch, dataRoot } = makeDocHost();
  try {
    const [render] = buildMiniAppDeferredTools(host, { cwd: scratch, workspaceDir: scratch });

    const result = await render.tool.execute("t1", { docPath: "draft.md" }) as any;
    // The subprocess handler read the staged copy out of its own dataDir and
    // saw the metadata match the rewritten param - the whole chain (staging,
    // in-place rewrite, IPC marshal, worker context rebuild) is proven by one
    // round trip.
    assert.equal(result.content[0].text, "# staged body|draft.md|true");
    assert.equal(JSON.stringify(result.details).includes(dataRoot), false);
  } finally {
    host.dispose();
  }
});

test("a file param without a staging scope fails loudly instead of passing a host path", async () => {
  const { host } = makeDocHost();
  try {
    const [render] = buildMiniAppDeferredTools(host);
    const result = await render.tool.execute("t1", { docPath: "draft.md" }) as any;
    assert.match(result.error as string, /cannot stage files/);
  } finally {
    host.dispose();
  }
});

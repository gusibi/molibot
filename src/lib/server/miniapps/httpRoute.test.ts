import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMiniAppHost, type MiniAppEnablementEntry, type MiniAppHost } from "$lib/server/miniapps/host.js";
import {
  handleMiniAppRequest,
  MINIAPP_PROXY_HEADER,
  MINIAPP_PROXY_VALUE
} from "$lib/server/miniapps/httpRoute.js";

/**
 * The Mini App HTTP seam, request in / response out.
 *
 * This is where the bidirectional round-trip closes: a tool call must be
 * visible to the app's API and vice versa, because both run against one runtime
 * over one data directory. It is also where the loopback exposure is contained
 * — an unproxied request must not reach an app at all.
 */

const APP_SOURCE = `import fs from "node:fs";
import path from "node:path";

export default function create(context) {
  const file = path.join(context.dataDir, "todos.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const write = (rows) => fs.writeFileSync(file, JSON.stringify(rows), "utf8");
  let seq = 0;
  const add = (title) => {
    const rows = read();
    seq += 1;
    rows.push({ id: String(Date.now()) + "-" + seq, title, completed: false });
    write(rows);
    return rows;
  };

  return {
    tools: {
      add: async (input) => ({ content: [{ type: "text", text: "added" }], structuredContent: add(input.title), changed: true }),
      list: async () => ({ content: [{ type: "text", text: JSON.stringify(read()) }], structuredContent: read() })
    },
    async handleHttp(request) {
      if (request.path === "/todos" && request.method === "GET") {
        return { body: { todos: read() } };
      }
      if (request.path === "/todos" && request.method === "POST") {
        return { status: 201, body: { todos: add(request.body.title) }, changed: true };
      }
      if (request.path === "/todos" && request.method === "PUT") {
        write(request.body.todos);
        return { body: { todos: read() }, changed: true };
      }
      if (request.path === "/echo") {
        return { body: { method: request.method, path: request.path, query: request.query, body: request.body } };
      }
      if (request.path.startsWith("/upload")) {
        return { body: { bytes: request.body.byteLength, contentType: request.contentType } };
      }
      if (request.path === "/leak") {
        return { body: { dataDir: context.dataDir } };
      }
      if (request.path === "/boom") {
        throw new Error("internal failure at " + context.dataDir);
      }
      return { status: 404, body: { error: "unknown route" } };
    }
  };
}
`;

const MANIFEST = {
  manifestVersion: 1,
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  engines: { molibot: ">=0.0.1" },
  runtime: { entry: "server/index.mjs" },
  ui: { entry: "ui/index.html" },
  data: { schemaVersion: 1 },
  ai: {
    capabilities: ["transcription"],
    uploadLimits: [{ path: "/api/upload", maxBytes: 8 }]
  },
  tools: [
    {
      name: "add",
      description: "Add a todo.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", minLength: 1 } },
        required: ["title"],
        additionalProperties: false
      }
    },
    {
      name: "list",
      description: "List todos.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      readOnlyHint: true
    }
  ]
};

interface Harness {
  host: MiniAppHost;
  root: string;
  dataRoot: string;
  enablement: Record<string, MiniAppEnablementEntry>;
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-http-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  const appDir = join(codeRoot, "todo");
  mkdirSync(join(appDir, "server"), { recursive: true });
  mkdirSync(join(appDir, "ui", "assets"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify(MANIFEST), "utf8");
  writeFileSync(join(appDir, "server", "index.mjs"), APP_SOURCE, "utf8");
  writeFileSync(join(appDir, "ui", "index.html"), "<!doctype html><title>Todo</title>", "utf8");
  writeFileSync(join(appDir, "ui", "app.js"), "console.log('todo');", "utf8");
  writeFileSync(join(appDir, "ui", "styles.css"), ":root{color:red}", "utf8");
  writeFileSync(join(appDir, "ui", "assets", "icon.svg"), "<svg/>", "utf8");
  writeFileSync(join(root, "secret.txt"), "top secret", "utf8");

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
  return { host, root, dataRoot, enablement };
}

function proxied(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> ?? {}), [MINIAPP_PROXY_HEADER]: MINIAPP_PROXY_VALUE }
  });
}

function call(harness: Harness, rest: string, request: Request): Promise<Response> {
  return handleMiniAppRequest("todo", rest, request, { host: harness.host });
}

test("UI assets are served with their own content types and a restrictive document CSP", async () => {
  const harness = makeHarness();

  const document = await call(harness, "", proxied("http://127.0.0.1:3000/miniapps/todo/"));
  assert.equal(document.status, 200);
  assert.equal(document.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await document.text(), /<title>Todo<\/title>/);

  const csp = document.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors/);

  for (const [path, type] of [
    ["app.js", "text/javascript; charset=utf-8"],
    ["styles.css", "text/css; charset=utf-8"],
    ["assets/icon.svg", "image/svg+xml"]
  ]) {
    const response = await call(harness, path, proxied(`http://127.0.0.1:3000/miniapps/todo/${path}`));
    assert.equal(response.status, 200, `${path} should be served`);
    assert.equal(response.headers.get("content-type"), type);
  }
});

test("a request without the transport proxy header never reaches the app", async () => {
  const harness = makeHarness();

  // The exact shape a malicious page can send without triggering a preflight.
  const simplePost = new Request("http://127.0.0.1:3000/miniapps/todo/api/todos", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://evil.example" },
    body: JSON.stringify({ title: "injected" })
  });
  const refused = await call(harness, "api/todos", simplePost);
  assert.equal(refused.status, 403);
  // No CORS permission is granted, so a cross-origin caller cannot even read it.
  assert.equal(refused.headers.get("access-control-allow-origin"), null);

  const asset = await call(harness, "", new Request("http://127.0.0.1:3000/miniapps/todo/"));
  assert.equal(asset.status, 403);

  const listed = await harness.host.invokeTool("miniapp__todo__list", {}, { toolCallId: "t1" });
  assert.deepEqual(listed.structuredContent, [], "the refused POST must not have written anything");
});

test("path escapes, cross-app access and unknown types are refused", async () => {
  const harness = makeHarness();

  for (const attempt of [
    "../manifest.json",
    "../../secret.txt",
    "..%2f..%2fsecret.txt",
    "%2e%2e%2f%2e%2e%2fsecret.txt",
    "%252e%252e%252fsecret.txt",
    "./../server/index.mjs",
    ".hidden"
  ]) {
    const response = await call(harness, attempt, proxied(`http://127.0.0.1:3000/miniapps/todo/${attempt}`));
    assert.ok(response.status === 400 || response.status === 404, `"${attempt}" must be refused, got ${response.status}`);
    const text = await response.text();
    assert.equal(text.includes("top secret"), false, `"${attempt}" leaked file contents`);
  }

  // An app id that is not installed is a 404, and an invalid one a 400 — neither
  // may reach the installed app's directory.
  const otherApp = await handleMiniAppRequest("expenses", "", proxied("http://127.0.0.1:3000/miniapps/expenses/"), { host: harness.host });
  assert.equal(otherApp.status, 404);
  const badId = await handleMiniAppRequest("../todo", "", proxied("http://127.0.0.1:3000/miniapps/x/"), { host: harness.host });
  assert.equal(badId.status, 400);
});

test("JSON methods reach the app handler with decoded body and query", async () => {
  const harness = makeHarness();

  const response = await call(
    harness,
    "api/echo",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/echo?status=open&status=done&q=milk", {
      method: "PATCH",
      body: JSON.stringify({ hello: "world" })
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    method: "PATCH",
    path: "/echo",
    query: { status: ["open", "done"], q: ["milk"] },
    body: { hello: "world" }
  });
});

test("PUT reaches the app handler and persists, like the panel settings save", async () => {
  const harness = makeHarness();

  // The panel's settings save uses PUT with a JSON body; a 405 at any gate
  // here silently kills every app-level PUT (theme + R2 settings).
  const response = await call(
    harness,
    "api/todos",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", {
      method: "PUT",
      body: JSON.stringify({ todos: [{ id: "1", title: "persisted", completed: false }] })
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).todos, [{ id: "1", title: "persisted", completed: false }]);

  // Same instance, fresh read: the write landed in the app's own store.
  const listed = await harness.host.invokeTool("miniapp__todo__list", {}, { toolCallId: "t1" });
  assert.deepEqual(listed.structuredContent, [{ id: "1", title: "persisted", completed: false }]);

  // A second host over the same data dir (disable -> re-enable) keeps the write.
  const restarted = createMiniAppHost({
    codeRoot: join(harness.root, "apps"),
    dataRoot: harness.dataRoot,
    getEnablement: () => harness.enablement,
    setEnablement: (appId, entry) => {
      if (entry === null) delete harness.enablement[appId];
      else harness.enablement[appId] = entry;
    }
  });
  const reloaded = await restarted.handleHttp(
    "todo",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", { method: "GET" }),
    "/todos"
  );
  assert.equal(reloaded.status, 200);
  assert.deepEqual((await reloaded.json()).todos, [{ id: "1", title: "persisted", completed: false }]);
  await restarted.dispose();
});

test("an oversized body is rejected before the app sees it", async () => {
  const harness = makeHarness();
  const huge = JSON.stringify({ title: "x".repeat(1024 * 1024 + 64) });
  const response = await call(
    harness,
    "api/todos",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", { method: "POST", body: huge })
  );
  assert.equal(response.status, 413);
});

test("a non-JSON body is rejected", async () => {
  const harness = makeHarness();
  const response = await call(
    harness,
    "api/todos",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", { method: "POST", body: "not json at all" })
  );
  assert.equal(response.status, 400);
});

test("only a declared upload path receives raw bytes and its route limit runs before the app", async () => {
  const harness = makeHarness();
  const accepted = await call(
    harness,
    "api/upload/chunk",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/upload/chunk", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: new Uint8Array([1, 2, 3])
    })
  );
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { bytes: 3, contentType: "audio/webm" });

  const overLimit = await call(
    harness,
    "api/upload",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/upload", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: new Uint8Array(9)
    })
  );
  assert.equal(overLimit.status, 413);

  const undeclared = await call(
    harness,
    "api/echo",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/echo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1])
    })
  );
  assert.equal(undeclared.status, 400);
});

test("tool writes are visible to the API and API writes are visible to tools", async () => {
  const harness = makeHarness();

  // Agent -> UI
  await harness.host.invokeTool("miniapp__todo__add", { title: "买牛奶" }, { toolCallId: "t1" });
  const fromApi = await call(harness, "api/todos", proxied("http://127.0.0.1:3000/miniapps/todo/api/todos"));
  assert.deepEqual((await fromApi.json()).todos.map((row: any) => row.title), ["买牛奶"]);

  // UI -> Agent
  const created = await call(
    harness,
    "api/todos",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", { method: "POST", body: JSON.stringify({ title: "写周报" }) })
  );
  assert.equal(created.status, 201);
  const fromTool = await harness.host.invokeTool("miniapp__todo__list", {}, { toolCallId: "t2" });
  assert.deepEqual((fromTool.structuredContent as any[]).map((row) => row.title), ["买牛奶", "写周报"]);
});

test("revision advances monotonically and _host/state reports it without an app round-trip", async () => {
  const harness = makeHarness();

  const initial = await call(harness, "api/_host/state", proxied("http://127.0.0.1:3000/miniapps/todo/api/_host/state"));
  assert.deepEqual(await initial.json(), { appId: "todo", enabled: true, revision: 0, schemaVersion: 1 });

  await harness.host.invokeTool("miniapp__todo__add", { title: "a" }, { toolCallId: "t1" });
  await call(
    harness,
    "api/todos",
    proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", { method: "POST", body: JSON.stringify({ title: "b" }) })
  );

  const after = await call(harness, "api/_host/state", proxied("http://127.0.0.1:3000/miniapps/todo/api/_host/state"));
  assert.equal((await after.json()).revision, 2, "both entrances must advance the same counter");

  // A read must not bump it, or the UI would poll in a permanent refresh loop.
  await call(harness, "api/todos", proxied("http://127.0.0.1:3000/miniapps/todo/api/todos"));
  const unchanged = await call(harness, "api/_host/state", proxied("http://127.0.0.1:3000/miniapps/todo/api/_host/state"));
  assert.equal((await unchanged.json()).revision, 2);
});

test("concurrent API writes do not lose data", async () => {
  const harness = makeHarness();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      call(
        harness,
        "api/todos",
        proxied("http://127.0.0.1:3000/miniapps/todo/api/todos", {
          method: "POST",
          body: JSON.stringify({ title: `item-${index}` })
        })
      )
    )
  );

  const listed = await harness.host.invokeTool("miniapp__todo__list", {}, { toolCallId: "t1" });
  assert.equal((listed.structuredContent as any[]).length, 20);
  assert.equal(harness.host.getRevision("todo"), 20);
});

test("a disabled app returns 403 on both its UI and its API", async () => {
  const harness = makeHarness();
  harness.host.setEnabled("todo", false);

  const ui = await call(harness, "", proxied("http://127.0.0.1:3000/miniapps/todo/"));
  assert.equal(ui.status, 403);
  const api = await call(harness, "api/todos", proxied("http://127.0.0.1:3000/miniapps/todo/api/todos"));
  assert.equal(api.status, 403);
  const state = await call(harness, "api/_host/state", proxied("http://127.0.0.1:3000/miniapps/todo/api/_host/state"));
  assert.equal(state.status, 403);
});

test("responses never contain host absolute paths or stacks", async () => {
  const harness = makeHarness();

  // The app itself may hand back its data dir; that is the app author's choice
  // and the host cannot prevent it. What the host guarantees is that *host*
  // failures never leak one.
  const failure = await call(harness, "api/boom", proxied("http://127.0.0.1:3000/miniapps/todo/api/boom"));
  assert.equal(failure.status, 500);
  const text = await failure.text();
  assert.equal(text.includes(harness.dataRoot), false, "a handler crash leaked the data root");
  assert.equal(text.includes("at "), false, "a handler crash leaked a stack frame");
});

test("an unsupported method on an asset path is a 405, not a route miss", async () => {
  const harness = makeHarness();
  const response = await call(
    harness,
    "app.js",
    proxied("http://127.0.0.1:3000/miniapps/todo/app.js", { method: "POST", body: "{}" })
  );
  assert.equal(response.status, 405);
});

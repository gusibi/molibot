import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import createPromptBox from "./builtin/prompt-box/server/index.mjs";
import { getBuiltinMiniApp, listBuiltinMiniApps } from "./bootstrap.js";
import { materializeBuiltinMiniApp } from "./builtinPackage.js";
import { readMiniAppManifest } from "./manifest.js";
import { sanitizeMiniAppResultCard } from "$lib/shared/miniappCard.js";

function request(path: string, method = "GET", body?: unknown, query: Record<string, string[]> = {}) {
  return { method, path, body, query, signal: new AbortController().signal };
}

function contextOver(dataDir: string, appId = "prompt-box") {
  return {
    appId,
    dataDir,
    logger: { info() {}, warn() {}, error() {} }
  };
}

test("Prompt Box stores, lists, updates, and deletes prompts via HTTP API and Agent tools", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-prompt-box-crud-"));
  const app = createPromptBox(contextOver(dataDir));

  // 1. Create prompts via HTTP API
  const createRes1 = await app.handleHttp(
    request("/prompts", "POST", {
      title: "Code Review Assistant",
      content: "Please review this code for performance, readability, and security issues.",
      description: "Detailed code review helper",
      tags: ["coding", "review"]
    })
  );
  assert.equal(createRes1.status, 201);
  const p1 = createRes1.body.prompt;
  assert.equal(p1.title, "Code Review Assistant");
  assert.deepEqual(p1.tags, ["coding", "review"]);

  const createRes2 = await app.handleHttp(
    request("/prompts", "POST", {
      title: "English Translator",
      content: "Translate the following text to natural, idiomatic English.",
      description: "Translation helper",
      tags: ["translation", "language"]
    })
  );
  const p2 = createRes2.body.prompt;

  // 2. List prompts & filters
  const listAll = await app.handleHttp(request("/prompts", "GET"));
  assert.equal(listAll.body.prompts.length, 2);

  const filterTag = await app.handleHttp(
    request("/prompts", "GET", undefined, { tag: ["coding"] })
  );
  assert.equal(filterTag.body.prompts.length, 1);
  assert.equal(filterTag.body.prompts[0].id, p1.id);

  const filterQuery = await app.handleHttp(
    request("/prompts", "GET", undefined, { query: ["Translate"] })
  );
  assert.equal(filterQuery.body.prompts.length, 1);
  assert.equal(filterQuery.body.prompts[0].id, p2.id);

  // 3. Get single prompt
  const getRes = await app.handleHttp(request(`/prompts/${p1.id}`, "GET"));
  assert.equal(getRes.body.prompt.title, "Code Review Assistant");

  // 4. Update prompt
  const updateRes = await app.handleHttp(
    request(`/prompts/${p1.id}`, "PATCH", {
      title: "Code Review & Security Specialist",
      tags: ["coding", "review", "security"]
    })
  );
  assert.equal(updateRes.body.prompt.title, "Code Review & Security Specialist");
  assert.deepEqual(updateRes.body.prompt.tags, ["coding", "review", "security"]);

  // 5. Delete prompt
  const deleteRes = await app.handleHttp(request(`/prompts/${p2.id}`, "DELETE"));
  assert.equal(deleteRes.body.prompt.id, p2.id);

  const listAfterDelete = await app.handleHttp(request("/prompts", "GET"));
  assert.equal(listAfterDelete.body.prompts.length, 1);

  // 6. list_prompts tool output must expose ids so the agent can address
  // delete_prompt / update_prompt / get_prompt without guessing.
  const listTool = await app.tools.list_prompts({});
  const listedText = listTool.content[0].text as string;
  assert.match(listedText, /\(id: [0-9a-f-]{36}\)/);

  app.dispose();
});

test("Prompt Box delete survives sync: tombstoned remote items never resurrect", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-prompt-box-delete-sync-"));
  const app = createPromptBox(contextOver(dataDir));

  await app.handleHttp(
    request("/settings", "POST", {
      apiKey: "test_key",
      apiUrl: "https://mock.pb.local/api"
    })
  );

  // Remote holds two prompts; the owner deletes one of them locally.
  const mockRemotePrompts = [
    {
      id: "rem_keep_1",
      title: "Keep Me",
      content: "Survives every sync.",
      tags: ["cloud"]
    },
    {
      id: "rem_delete_1",
      title: "Delete Me",
      content: "Was deleted on this device.",
      tags: ["cloud"]
    }
  ];

  const remoteCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input);
    const method = init?.method || "GET";
    remoteCalls.push(`${method} ${url}`);
    if (method === "GET" && url.endsWith("/prompts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockRemotePrompts })
      } as any;
    }
    // The real remote has no delete endpoint; nothing else may be attempted.
    return { ok: false, status: 404, text: async () => "Not Found" } as any;
  };

  try {
    // First sync imports both remote prompts.
    await app.handleHttp(request("/sync", "POST"));
    let listRes = await app.handleHttp(request("/prompts", "GET"));
    assert.equal(listRes.body.prompts.length, 2);
    const doomed = listRes.body.prompts.find((p: any) => p.title === "Delete Me");
    assert.ok(doomed?.remoteId);

    // Owner deletes one prompt via the HTTP API.
    const deleteRes = await app.handleHttp(request(`/prompts/${doomed.id}`, "DELETE"));
    assert.equal(deleteRes.body.prompt.id, doomed.id);
    assert.equal(deleteRes.changed, true);

    // A later sync must NOT resurrect the deleted prompt even though the
    // remote still returns it, and must keep importing the surviving one.
    const syncRes = await app.handleHttp(request("/sync", "POST"));
    assert.equal(syncRes.body.success, true);
    assert.equal(syncRes.body.pulledCount, 1);
    assert.equal(syncRes.body.skippedDeletedCount, 1);

    listRes = await app.handleHttp(request("/prompts", "GET"));
    assert.equal(listRes.body.prompts.length, 1);
    assert.equal(listRes.body.prompts[0].title, "Keep Me");

    // The same guarantee holds for the agent-facing delete tool.
    const toolDelete = await app.tools.delete_prompt({ id: listRes.body.prompts[0].id });
    assert.equal(toolDelete.changed, true);
    const syncAfterToolDelete = await app.handleHttp(request("/sync", "POST"));
    assert.equal(syncAfterToolDelete.body.pulledCount, 0);
    assert.equal(syncAfterToolDelete.body.skippedDeletedCount, 2);
    const finalList = await app.handleHttp(request("/prompts", "GET"));
    assert.equal(finalList.body.prompts.length, 0);

    // The remote offers only a read-only list; deletes are enforced purely by
    // local tombstones, so sync must never attempt a mutating remote call.
    assert.ok(
      remoteCalls.every((call) => call.startsWith("GET ")),
      `Remote must only ever be listed, never mutated: ${remoteCalls.join(", ")}`
    );
  } finally {
    globalThis.fetch = originalFetch;
    app.dispose();
  }
});

test("Prompt Box manages API Key and settings correctly", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-prompt-box-settings-"));
  const app = createPromptBox(contextOver(dataDir));

  // Initial settings
  const initialSettings = await app.handleHttp(request("/settings", "GET"));
  assert.equal(initialSettings.body.settings.apiKeyPresent, false);
  assert.equal(initialSettings.body.settings.apiUrl, "https://pb.onlinestool.com/api");

  // Save settings
  const savedSettings = await app.handleHttp(
    request("/settings", "POST", {
      apiKey: "pb_live_secret_1234567890abcdef",
      apiUrl: "https://pb.custom-host.com/api"
    })
  );
  assert.equal(savedSettings.body.settings.apiKeyPresent, true);
  assert.equal(savedSettings.body.settings.apiUrl, "https://pb.custom-host.com/api");
  assert.match(savedSettings.body.settings.apiKeyMasked, /^pb_l••••cdef$/);

  app.dispose();
});

test("Prompt Box save_prompt tool handles message capture and returns card", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-prompt-box-capture-"));
  const app = createPromptBox(contextOver(dataDir, "prompt-box"));

  const toolResult = await app.tools.save_prompt({
    capture: {
      text: "You are an expert software architect. Analyze the given code and recommend best practices.",
      selection: "You are an expert software architect. Analyze the given code and recommend best practices.",
      role: "assistant",
      capturedAt: new Date().toISOString(),
      source: { sessionTitle: "Architecture Discussion" }
    }
  });

  assert.equal(toolResult.changed, true);
  assert.ok(toolResult.structuredContent.id);
  assert.match(toolResult.structuredContent.title, /expert software architect/);
  assert.deepEqual(toolResult.structuredContent.tags, ["captured"]);

  // Verify result card format
  const sanitizedCard = sanitizeMiniAppResultCard(toolResult.card, "prompt-box");
  assert.ok(sanitizedCard, "Prompt Box card must be sanitizable by host");
  assert.equal(sanitizedCard.title, "Saved to Prompt Box");
  assert.equal(sanitizedCard.icon, "sparkle");
  assert.ok(sanitizedCard.link?.startsWith("molibot://miniapp/prompt-box"));

  // Check that the prompt is searchable
  const listResult = await app.tools.list_prompts({ query: "software architect" });
  assert.equal(listResult.structuredContent.length, 1);

  app.dispose();
});

test("Prompt Box two-way sync pushes local unsynced prompts and pulls remote items", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-prompt-box-twoway-sync-"));
  const app = createPromptBox(contextOver(dataDir));

  // Configure settings
  await app.handleHttp(
    request("/settings", "POST", {
      apiKey: "test_key",
      apiUrl: "https://mock.pb.local/api"
    })
  );

  // 1. Create a local-only prompt (has no remoteId yet)
  const localCreate = await app.handleHttp(
    request("/prompts", "POST", {
      title: "Local Offline Prompt",
      content: "Created locally before sync.",
      tags: ["offline"]
    })
  );
  assert.equal(localCreate.body.prompt.remoteId, undefined);

  // Mock remote API
  const pushedItems: any[] = [];
  const mockRemotePrompts = [
    {
      id: "rem_cloud_1",
      title: "Cloud Prompt 1",
      content: "Stored on server.",
      tags: ["cloud"],
      example_image_url: "Https://tutu.onlinestool.com/5012bc82.png",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z"
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input);
    const method = init?.method || "GET";

    if (method === "POST" && url.endsWith("/prompts")) {
      const body = JSON.parse(init.body);
      const newRemote = { id: "rem_from_push_123", ...body };
      pushedItems.push(newRemote);
      return {
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: newRemote })
      } as any;
    }

    if (method === "GET" && url.endsWith("/prompts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [...mockRemotePrompts, ...pushedItems] })
      } as any;
    }

    return { ok: false, status: 404, text: async () => "Not Found" } as any;
  };

  try {
    const syncRes = await app.handleHttp(request("/sync", "POST"));
    assert.equal(syncRes.body.success, true);
    assert.equal(syncRes.body.pushedCount, 1);
    assert.equal(syncRes.body.pulledCount, 2);
    assert.equal(pushedItems.length, 1);
    assert.equal(pushedItems[0].title, "Local Offline Prompt");

    // Verify local prompt now has remote_id and exampleImageUrl normalized
    const listRes = await app.handleHttp(request("/prompts", "GET"));
    assert.equal(listRes.body.prompts.length, 2);
    const localUpdated = listRes.body.prompts.find((p: any) => p.title === "Local Offline Prompt");
    assert.equal(localUpdated.remoteId, "rem_from_push_123");

    const cloudItem = listRes.body.prompts.find((p: any) => p.title === "Cloud Prompt 1");
    assert.equal(cloudItem.exampleImageUrl, "https://tutu.onlinestool.com/5012bc82.png");
  } finally {
    globalThis.fetch = originalFetch;
    app.dispose();
  }
});

test("Prompt Box is registered in built-ins and materializes valid bundle", () => {
  const builtin = getBuiltinMiniApp("prompt-box");
  assert.ok(builtin, "prompt-box must be registered in BUILTIN_APPS");
  assert.equal(builtin.id, "prompt-box");

  // Verify materialization
  const tempRoot = mkdtempSync(join(tmpdir(), "molibot-prompt-box-materialize-"));
  materializeBuiltinMiniApp(tempRoot, builtin);

  const appDir = join(tempRoot, "prompt-box");
  assert.ok(existsSync(join(appDir, "manifest.json")));
  assert.ok(existsSync(join(appDir, "server/index.mjs")));
  assert.ok(existsSync(join(appDir, "ui/index.html")));
  assert.ok(existsSync(join(appDir, "ui/app.js")));
  assert.ok(existsSync(join(appDir, "ui/astryx.css")));
  assert.ok(existsSync(join(appDir, "ui/styles.css")));
  assert.ok(existsSync(join(appDir, "ui/icon.svg")));

  const manifestValidation = readMiniAppManifest(appDir, "prompt-box");
  assert.ok(manifestValidation.ok, `Manifest validation failed: ${manifestValidation.error}`);
  assert.equal(manifestValidation.value.manifest.name, "Prompt Box");
  assert.equal(manifestValidation.value.manifest.contributions?.messageActions?.[0]?.tool, "save_prompt");
});

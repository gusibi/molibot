import { sendFeishuFile } from "$lib/server/channels/feishu/messaging.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createModels, createProvider, type AssistantImages, type ImageModel } from "@earendil-works/pi-ai";
import { createPiImageProvider, listPiImageModels } from "./piProvider.js";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageGenerateTool } from "./imageGenerateTool.js";
import { SqliteImageTaskStore } from "./imageTaskStore.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { GET as downloadImage } from "../../../../routes/api/settings/image-generate/image/+server.js";

const model: ImageModel<"openrouter-images"> = {
  type: "image", api: "openrouter-images", provider: "fixture", id: "studio/image", name: "Studio image",
  baseUrl: "http://fixture.invalid", input: ["text", "image"], output: ["image", "text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }
};

function fixture(stopReason: AssistantImages["stopReason"] = "stop", empty = false, firstMime = "image/png", exerciseHttp = false, binary = false, withUsage = false, onReturn?: () => void) {
  const models = createModels();
  let calls = 0;
  models.setProvider(createProvider({
    id: "fixture", name: "Fixture", models: [model],
    auth: { apiKey: { name: "Fixture key", resolve: async () => ({ auth: { apiKey: "fixture-key" } }) } },
    images: { "openrouter-images": { generateImages: async (_model, context, options) => {
      calls++;
      if (exerciseHttp) await options!.fetch!("https://fixture.invalid/image", {
        method: "POST", headers: { authorization: "Bearer provider-secret" },
        body: JSON.stringify({ input: [{ type: "image", data: "private-reference-bytes" }] })
      });
      assert.equal(context.input[0].type, "text");
      assert.equal(options?.maxRetries, 0, "image generation must not silently retry a paid request");
      onReturn?.();
      return {
        api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(),
        ...(withUsage ? { usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } } } : {}),
        errorMessage: stopReason === "error" ? "provider rejected request" : undefined,
        output: empty ? [] : [
          { type: "text", text: "Two versions" },
          { type: "image", mimeType: firstMime, data: (binary ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) : Buffer.from("first")).toString("base64") },
          { type: "image", mimeType: "image/webp", data: (binary ? Buffer.from("RIFF\0\0\0\0WEBP", "binary") : Buffer.from("second")).toString("base64") }
        ]
      };
    } } }
  }));
  return { models, calls: () => calls };
}

const context = { settings: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true } } }, fetch };

test("Pi image provider preserves all output images and companion text without inventing usage", async () => {
  const { models } = fixture();
  assert.deepEqual(listPiImageModels(models).map(item => item.key), ["pi|fixture|studio/image"]);
  const result = await createPiImageProvider(models).generate({ prompt: "Draw a poster", model: "pi|fixture|studio/image" }, context);
  assert.deepEqual(result.images?.map(image => [image.mimeType, image.imageBuffer?.toString()]), [["image/png", "first"], ["image/webp", "second"]]);
  assert.equal(result.text, "Two versions");
  assert.equal(result.usage, undefined);
});

for (const reason of ["error", "aborted"] as const) {
  test(`Pi image ${reason} cannot become a successful generation`, async () => {
    const { models } = fixture(reason);
    await assert.rejects(() => createPiImageProvider(models).generate({ prompt: "Draw", model: "pi|fixture|studio/image" }, context), reason === "error" ? /rejected/ : /abort/i);
  });
}

test("Pi image empty output and unsupported parameters fail explicitly", async () => {
  const { models, calls } = fixture("stop", true);
  const provider = createPiImageProvider(models);
  await assert.rejects(() => provider.generate({ prompt: "Draw", model: "pi|fixture|studio/image", seed: 1 }, context), /seed/);
  await assert.rejects(() => provider.generate({ prompt: "Draw", model: "pi|fixture|studio/image", size: "1024x1024" }, context), /size/);
  assert.equal(calls(), 0);
  await assert.rejects(() => provider.generate({ prompt: "Draw", model: "pi|fixture|studio/image" }, context), /no images/i);
  await assert.rejects(() => provider.generate({ prompt: "Draw", model: "pi|fixture|missing" }, context), /image model/i);
});

test("Pi missing credentials fail without starting a provider operation", async () => {
  const { models, calls } = fixture();
  models.setProvider({ ...models.getProvider("fixture")!, auth: {
    apiKey: { name: "Fixture key", resolve: async () => undefined }
  } });
  await assert.rejects(() => createPiImageProvider(models).generate({ prompt: "Draw", model: "pi|fixture|studio/image" }, context), /auth|key|configured/i);
  assert.equal(calls(), 0);
});

test("Pi reference images reach the dedicated image request", async () => {
  const models = createModels();
  models.setProvider(createProvider({
    id: "fixture", name: "Fixture", models: [model],
    auth: { apiKey: { name: "Fixture key", resolve: async () => ({ auth: { apiKey: "fixture-key" } }) } },
    images: { "openrouter-images": { generateImages: async (_model, input) => {
      assert.equal(input.input[1].type, "image");
      assert.deepEqual(input.input[1], { type: "image", mimeType: "image/png", data: Buffer.from("reference").toString("base64") });
      return { api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), output: [{ type: "image", mimeType: "image/png", data: Buffer.from("edited").toString("base64") }] };
    } } }
  }));
  const result = await createPiImageProvider(models).generate({ prompt: "Edit", model: "pi|fixture|studio/image", images: ["https://8.8.8.8/reference.png"] }, {
    ...context, fetch: async () => new Response("reference", { headers: { "content-type": "image/png" } })
  });
  assert.equal(result.images?.[0].imageBuffer.toString(), "edited");
});

test("a cancelled Pi image operation persists cancellation rather than success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-cancel-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  try {
    const controller = new AbortController();
    controller.abort();
    const { models, calls } = fixture();
    const tool = createImageGenerateTool({
      cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } })
    });
    await assert.rejects(() => tool.execute("cancelled-image", { prompt: "Draw" }, controller.signal));
    assert.equal(calls(), 0);
    assert.equal(store.getRecentTasks()[0].status, "cancelled");
    assert.deepEqual(store.getRecentTasks()[0].artifacts, []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the real image tool saves and sends every Pi output, then a fresh store restores them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-images-"));
  const dbPath = join(directory, "tasks.sqlite");
  let store = new SqliteImageTaskStore(dbPath);
  const originalDbPath = storagePaths.settingsDbFile;
  try {
    const { models, calls } = fixture("stop", false, "image/jpeg");
    const sent: string[] = [];
    const tool = createImageGenerateTool({
      cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: {
        enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } }
      } }),
      uploadFile: async path => { sent.push(path); }
    });
    const result = await tool.execute("image-request", { prompt: "Draw a poster", outputName: "poster.png" });
    assert.equal(calls(), 1);
    assert.equal(sent.length, 2, "a Channel must receive all successful images");
    assert.match(sent[0], /poster\.jpg$/);
    assert.match(sent[1], /poster-2\.webp$/);
    assert.deepEqual(sent.map(path => readFileSync(path, "utf8")), ["first", "second"]);
    assert.match(result.content[0].type === "text" ? result.content[0].text : "", /Two versions/);
    const taskId = (result.details as { taskId: string }).taskId;
    store.close();
    store = new SqliteImageTaskStore(dbPath);
    const restored = store.getTask(taskId)!;
    assert.equal(restored.status, "completed");
    assert.equal(restored.textOutput, "Two versions");
    assert.equal(restored.usage, undefined);
    assert.deepEqual(restored.artifacts?.map(artifact => artifact.mimeType), ["image/jpeg", "image/webp"]);
    assert.deepEqual(restored.artifacts?.map(artifact => readFileSync(artifact.path, "utf8")), ["first", "second"]);
    storagePaths.settingsDbFile = dbPath;
    for (const artifact of restored.artifacts!) {
      const response = await downloadImage({ url: new URL(`http://localhost/api/settings/image-generate/image?taskId=${taskId}&index=${artifact.index}`) } as Parameters<typeof downloadImage>[0]);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), artifact.mimeType);
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), artifact.index === 0 ? "first" : "second");
    }
    store.deleteTask(taskId);
    assert.equal(store.getTask(taskId), null);
  } finally {
    storagePaths.settingsDbFile = originalDbPath;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Pi image settings survive a complete settings store round trip without losing other engines", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-settings-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.dataDir = directory;
    storagePaths.dbDir = join(directory, "db");
    storagePaths.settingsDbFile = join(directory, "db", "settings.sqlite");
    storagePaths.settingsFile = join(directory, "settings.json");
    storagePaths.sessionsIndexFile = join(directory, "sessions-index.json");
    const imageGenerate = {
      ...defaultRuntimeSettings.imageGenerate,
      defaultEngine: "pi", engines: {
        ...Object.fromEntries(Object.entries(defaultRuntimeSettings.imageGenerate.engines).map(([id, engine]) => [id, { ...engine, enabled: false, apiKey: "" }])),
        pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image", name: "Pi" },
        studio: { enabled: true, apiKey: "local-test-key", baseUrl: "http://fixture.invalid", model: "studio", protocol: "chat-completions" as const }
      }
    };
    new SettingsStore().save({ ...defaultRuntimeSettings, imageGenerate });
    assert.deepEqual(JSON.parse(JSON.stringify(new SettingsStore().load().imageGenerate)), imageGenerate);
  } finally {
    Object.assign(storagePaths, originals);
    rmSync(directory, { recursive: true, force: true });
  }
});


test("Pi reference downloads reject private targets and oversized bodies before generation", async () => {
  const { models, calls } = fixture();
  let downloads = 0;
  const provider = createPiImageProvider(models);
  await assert.rejects(provider.generate({ prompt: "Edit", model: "pi|fixture|studio/image", images: ["http://127.0.0.1/private.png"] }, {
    ...context, fetch: async () => { downloads++; return new Response("private"); }
  }), /non-public/);
  assert.equal(downloads, 0);
  await assert.rejects(provider.generate({ prompt: "Edit", model: "pi|fixture|studio/image", images: ["https://8.8.8.8/reference.png"] }, {
    ...context, fetch: async (_url, init) => {
      assert.equal(init?.redirect, "error");
      return new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } });
    }
  }), /exceeds 10 MiB/);
  assert.equal(calls(), 0);
});


test("Pi HTTP logs omit request bodies, credentials and image response bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-logs-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];
  let bodyReads = 0;
  try {
    globalThis.fetch = async () => {
      const response = new Response(JSON.stringify({ inlineData: { data: "private-result-bytes" } }), { headers: { "content-type": "application/json" } });
      response.clone = () => { bodyReads++; throw new Error("Image payload must not be read for logging"); };
      return response;
    };
    console.log = (...args) => { logs.push(args.join(" ")); };
    const { models } = fixture("stop", false, "image/png", true);
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }) });
    const result = await tool.execute("image-log-request", { prompt: "Draw" });
    assert.equal(result.isError, undefined);
    assert.equal(bodyReads, 0);
    assert.doesNotMatch(logs.join("\n"), /private-reference-bytes|private-result-bytes|provider-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("a later artifact save failure retains the first generated image for download", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-partial-"));
  const dbPath = join(directory, "tasks.sqlite");
  const store = new SqliteImageTaskStore(dbPath);
  const originalDbPath = storagePaths.settingsDbFile;
  try {
    mkdirSync(join(directory, "poster-2.webp"));
    const { models, calls } = fixture();
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }) });
    await assert.rejects(tool.execute("partial-image-request", { prompt: "Draw", outputName: "poster.png" }), /EISDIR/);
    assert.equal(calls(), 1);
    const task = store.getRecentTasks()[0];
    assert.equal(task.status, "failed");
    assert.match(task.errorMessage!, /Images generated, but local artifact processing failed/);
    assert.equal(task.artifacts?.length, 1);
    storagePaths.settingsDbFile = dbPath;
    const response = await downloadImage({ url: new URL(`http://localhost/api/settings/image-generate/image?taskId=${task.id}&index=0`) } as Parameters<typeof downloadImage>[0]);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "first");
  } finally {
    storagePaths.settingsDbFile = originalDbPath;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("unsupported output MIME retains provider usage before artifact processing fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-mime-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  try {
    const { models } = fixture("stop", false, "image/svg+xml", false, false, true);
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }) });
    await assert.rejects(tool.execute("unsupported-mime", { prompt: "Draw" }), /MIME/);
    const task = store.getRecentTasks()[0];
    assert.equal(task.status, "failed");
    assert.ok(task.usage, "provider usage must survive even the first artifact validation failure");
    assert.equal(task.artifacts?.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Pi multiple outputs flow through the actual Feishu image adapter", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-feishu-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  const uploaded: Buffer[] = [];
  const messages: Array<{ data: { msg_type: string; content: string } }> = [];
  const client = { im: {
    image: { create: async (payload: { data: { image: Buffer } }) => { uploaded.push(payload.data.image); return { image_key: `image-${uploaded.length}` }; } },
    message: { create: async (payload: { data: { msg_type: string; content: string } }) => { messages.push(payload); return { data: { message_id: `message-${messages.length}` } }; } }
  } };
  try {
    const { models } = fixture("stop", false, "image/png", false, true);
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }),
      uploadFile: async (path, title) => { await sendFeishuFile(client as never, "test-chat", readFileSync(path), title!); } });
    await tool.execute("feishu-images", { prompt: "Draw" });
    assert.equal(uploaded.length, 2);
    assert.deepEqual(messages.map(message => message.data.msg_type), ["image", "image"]);
    assert.deepEqual(messages.map(message => JSON.parse(message.data.content).image_key), ["image-1", "image-2"]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("provider usage survives cancellation at return and no late images are saved", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-late-cancel-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  try {
    const controller = new AbortController();
    const { models } = fixture("stop", false, "image/png", false, false, true, () => controller.abort());
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }) });
    await assert.rejects(tool.execute("late-cancel", { prompt: "Draw" }, controller.signal));
    const task = store.getRecentTasks()[0];
    assert.equal(task.status, "cancelled");
    assert.equal(task.usage?.cost.total, 0.03);
    assert.deepEqual(task.artifacts, []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});


for (const [reason, empty] of [["error", false], ["stop", true]] as const) {
  test(`Pi ${empty ? "empty output" : "provider error"} retains reported usage without successful artifacts`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "molibot-pi-image-return-failure-"));
    const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
    try {
      const { models } = fixture(reason, empty, "image/png", false, false, true);
      const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
        getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: { enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } } } }) });
      await assert.rejects(tool.execute("return-failure", { prompt: "Draw" }));
      const task = store.getRecentTasks()[0];
      assert.equal(task.status, "failed");
      assert.equal(task.usage?.cost.total, 0.03);
      assert.deepEqual(task.artifacts, []);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test("partial multi-image delivery reports committed uploads without discarding saved outputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-partial-upload-"));
  const store = new SqliteImageTaskStore(join(directory, "tasks.sqlite"));
  try {
    const { models } = fixture();
    let attempts = 0;
    const tool = createImageGenerateTool({ cwd: directory, workspaceDir: directory, taskStore: store, piModels: models,
      getSettings: () => ({ ...defaultRuntimeSettings, imageGenerate: {
        enabled: true, defaultEngine: "pi", engines: { pi: { credentialSource: "provider" as const, enabled: true, model: "pi|fixture|studio/image" } }
      } }), uploadFile: async () => { if (++attempts === 2) throw new Error("second upload failed"); } });
    const result = await tool.execute("partial", { prompt: "Draw", outputName: "poster.png" });
    assert.equal(result.details.uploadedCount, 1);
    assert.equal(result.details.uploaded, false);
    assert.match(JSON.stringify(result.content), /uploaded 1\/2 images/);
    assert.equal(store.getRecentTasks()[0].artifacts?.length, 2);
    assert.equal(store.getRecentTasks()[0].status, "completed");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

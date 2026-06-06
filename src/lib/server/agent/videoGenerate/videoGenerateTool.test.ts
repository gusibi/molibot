import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVideoGenerateTool } from "./videoGenerateTool.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { SqliteVideoTaskStore } from "./videoTaskStore.js";

const mockCwd = join(process.cwd(), ".test-tmp/videoGenerateTest");
const mockWorkspace = mockCwd;
const mockArtifactDir = "2026/06/05";
const testDbFile = join(mockCwd, "test_settings.sqlite");

const defaultTestSettings: RuntimeSettings = {
  videoGenerate: {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: true, apiKey: "agnes-key", model: "agnes-video-v2.0" },
      volcengine: { enabled: false, apiKey: "", model: "doubao-seedance-2.0" }
    }
  }
} as unknown as RuntimeSettings;

function getTestContext(settingsPatch?: Partial<RuntimeSettings["videoGenerate"]>, uploadFile?: any, taskStore?: any) {
  const currentSettings = {
    ...defaultTestSettings,
    videoGenerate: {
      ...defaultTestSettings.videoGenerate,
      ...settingsPatch,
      engines: {
        ...defaultTestSettings.videoGenerate.engines,
        ...(settingsPatch?.engines || {})
      }
    }
  } as RuntimeSettings;

  return {
    getSettings: () => currentSettings,
    cwd: mockCwd,
    workspaceDir: mockWorkspace,
    artifactDir: mockArtifactDir,
    uploadFile,
    taskStore
  };
}

test("videoGenerate tool successfully submits Agnes task and queries completion", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;
  let requestHeaders: any = null;
  let pollHeaders: any = null;
  let downloadedUrl = "";
  let pollAttempts = 0;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.endsWith("/v1/videos") && init?.method === "POST") {
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        id: "agnes-task-123",
        video_id: "agnes-video-123",
        status: "queued"
      }), { status: 200 });
    }
    if (cleanUrl.includes("agnesapi?video_id=agnes-video-123") && init?.method !== "POST") {
      pollAttempts++;
      pollHeaders = init?.headers;
      if (pollAttempts === 1) {
        return new Response(JSON.stringify({ status: "in_progress", progress: 0.5 }), { status: 200 });
      } else {
        return new Response(JSON.stringify({
          status: "completed",
          video_url: "https://example.com/generated-agnes.mp4"
        }), { status: 200 });
      }
    }
    if (cleanUrl.includes("generated-agnes.mp4")) {
      downloadedUrl = cleanUrl;
      return new Response(Buffer.from("agnes-fake-mp4-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    // Clean potential collision ID from database
    const store = new SqliteVideoTaskStore(testDbFile);
    store.deleteTask("agnes-task-123");

    let uploadedFile: string | null = null;
    let uploadedTitle: string | null = null;
    const uploadFile = async (filePath: string, title?: string) => {
      uploadedFile = filePath;
      uploadedTitle = title || null;
    };

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.videoGenerate.engines,
        agnes: { enabled: true, apiKey: "agnes-test-api-key", model: "agnes-video-v2.0-custom", baseUrl: "https://custom.agnes.ai" }
      }
    }, uploadFile, store);

    const tool = createVideoGenerateTool(ctx);
    
    // 1. Submit
    const result1 = await tool.execute("call-1", {
      prompt: "A beautiful mountain river flow",
      engine: "agnes",
      duration: 5,
      ratio: "16:9",
      seed: 42,
      outputName: "agnes_river.mp4"
    });

    assert.equal(result1.details.status, "processing");
    assert.equal(result1.details.taskId, "agnes-task-123");
    assert.equal(requestPayload.prompt, "A beautiful mountain river flow");
    assert.equal(requestPayload.model, "agnes-video-v2.0-custom");
    assert.equal(requestPayload.num_frames, 121);
    assert.equal(requestPayload.frame_rate, 24);
    assert.equal(requestPayload.width, 1280);
    assert.equal(requestPayload.height, 720);
    assert.equal(requestPayload.seed, 42);
    assert.equal(requestHeaders["Authorization"], "Bearer agnes-test-api-key");

    // Verify task stored in SQLite
    const taskRecord = store.getTask("agnes-task-123");
    assert.ok(taskRecord);
    assert.equal(taskRecord.status, "processing");

    // 2. Query 1 (returns processing)
    const result2 = await tool.execute("call-1-query-1", {
      taskId: "agnes-task-123",
      engine: "agnes"
    });
    assert.equal(result2.details.status, "processing");
    assert.equal(result2.details.progress, 50);

    // 3. Query 2 (returns completed)
    const result3 = await tool.execute("call-1-query-2", {
      taskId: "agnes-task-123",
      engine: "agnes"
    });

    assert.equal(result3.details.status, "completed");
    assert.ok(result3.content[0].text.includes("Successfully completed video generation task 'agnes-task-123'."));
    assert.equal(pollHeaders["Authorization"], "Bearer agnes-test-api-key");
    assert.equal(pollAttempts, 2);
    assert.equal(downloadedUrl, "https://example.com/generated-agnes.mp4");

    const savedFilePath = join(mockCwd, mockArtifactDir, "agnes_river.mp4");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "agnes-fake-mp4-bytes");
    assert.equal(uploadedFile, savedFilePath);
    assert.equal(uploadedTitle, "agnes_river.mp4");

    const finalRecord = store.getTask("agnes-task-123");
    assert.equal(finalRecord?.status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool successfully submits Volcengine task and queries completion", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;
  let requestHeaders: any = null;
  let downloadedUrl = "";
  let pollAttempts = 0;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.endsWith("/api/plan/v3/contents/generations/tasks") && init?.method === "POST") {
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        id: "cgt-task-999"
      }), { status: 200 });
    }
    if (cleanUrl.includes("/api/plan/v3/contents/generations/tasks/cgt-task-999") && init?.method !== "POST") {
      pollAttempts++;
      if (pollAttempts === 1) {
        return new Response(JSON.stringify({ status: "running", progress: 40 }), { status: 200 });
      } else {
        return new Response(JSON.stringify({
          status: "succeeded",
          content: {
            video_url: "https://example.com/generated-volc.mp4"
          }
        }), { status: 200 });
      }
    }
    if (cleanUrl.includes("generated-volc.mp4")) {
      downloadedUrl = cleanUrl;
      return new Response(Buffer.from("volc-fake-mp4-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    // Clean potential collision ID from database
    const store = new SqliteVideoTaskStore(testDbFile);
    store.deleteTask("cgt-task-999");

    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "", model: "agnes-video-v2.0" },
        volcengine: { enabled: true, apiKey: "volc-test-key", model: "doubao-seedance-2.0-custom" }
      }
    }, undefined, store);

    const tool = createVideoGenerateTool(ctx);
    
    // 1. Submit
    const result1 = await tool.execute("call-2", {
      prompt: "A girl hugging a fox",
      engine: "volcengine",
      duration: 5,
      ratio: "adaptive",
      images: ["https://example.com/fox.png"],
      generateAudio: true,
      watermark: false,
      outputName: "volc_fox.mp4"
    });

    assert.equal(result1.details.status, "processing");
    assert.equal(result1.details.taskId, "cgt-task-999");
    assert.equal(requestPayload.content[0].text, "A girl hugging a fox");
    assert.equal(requestPayload.content[1].image_url.url, "https://example.com/fox.png");
    assert.equal(requestPayload.model, "doubao-seedance-2.0-custom");
    assert.equal(requestPayload.generate_audio, true);
    assert.equal(requestPayload.watermark, false);
    assert.equal(requestPayload.ratio, "adaptive");
    assert.equal(requestPayload.duration, 5);
    assert.equal(requestHeaders["Authorization"], "Bearer volc-test-key");

    // 2. Query 1 (returns processing)
    const result2 = await tool.execute("call-2-query-1", {
      taskId: "cgt-task-999",
      engine: "volcengine"
    });
    assert.equal(result2.details.status, "processing");
    assert.equal(result2.details.progress, 40);

    // 3. Query 2 (returns completed)
    const result3 = await tool.execute("call-2-query-2", {
      taskId: "cgt-task-999",
      engine: "volcengine"
    });

    assert.equal(result3.details.status, "completed");
    assert.equal(pollAttempts, 2);
    assert.equal(downloadedUrl, "https://example.com/generated-volc.mp4");

    const savedFilePath = join(mockCwd, mockArtifactDir, "volc_fox.mp4");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "volc-fake-mp4-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool resolves auto engine correctly based on priority", async () => {
  const originalFetch = globalThis.fetch;
  let resolvedEngine: string | null = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if ((cleanUrl.includes("volces") || cleanUrl.includes("volcengine")) && init?.method === "POST") {
      resolvedEngine = "volcengine";
      return new Response(JSON.stringify({ id: "volc-123" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    // Clean potential collision ID from database
    const store = new SqliteVideoTaskStore(testDbFile);
    store.deleteTask("volc-123");

    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "", model: "agnes-video-v2.0" },
        volcengine: { enabled: true, apiKey: "volc-key", model: "doubao-seedance-2.0" }
      }
    }, undefined, store);

    const tool = createVideoGenerateTool(ctx);
    const result = await tool.execute("call-3", {
      prompt: "A cute panda eating bamboo",
      engine: "auto",
      outputName: "auto_panda.mp4"
    });

    assert.equal(resolvedEngine, "volcengine");
    assert.equal(result.details.status, "processing");
    assert.equal(result.details.taskId, "volc-123");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool supports query progress by taskId and updates status", async () => {
  const originalFetch = globalThis.fetch;
  let queryCount = 0;
  let downloaded = false;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("/v1/videos/agnes-async-task-456") && init?.method !== "POST") {
      queryCount++;
      if (queryCount === 1) {
        return new Response(JSON.stringify({ status: "in_progress", progress: 0.5 }), { status: 200 });
      } else {
        return new Response(JSON.stringify({
          status: "completed",
          video_url: "https://example.com/async-completed.mp4"
        }), { status: 200 });
      }
    }
    if (cleanUrl.includes("async-completed.mp4")) {
      downloaded = true;
      return new Response(Buffer.from("async-video-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    // Seed task in SQLite
    const store = new SqliteVideoTaskStore(testDbFile);
    store.deleteTask("agnes-async-task-456");
    store.createTask("agnes-async-task-456", "agnes", "default", "A beautiful mountain river flow", { model: "agnes-video-v2.0" });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.videoGenerate.engines,
        agnes: { enabled: true, apiKey: "agnes-async-key", model: "agnes-video-v2.0" }
      }
    }, undefined, store);

    const tool = createVideoGenerateTool(ctx);

    // Call 1: should return processing
    const result1 = await tool.execute("call-async-query-1", {
      taskId: "agnes-async-task-456",
      engine: "agnes"
    });
    assert.equal(result1.details.status, "processing");
    assert.equal(queryCount, 1);

    // Call 2: should return completed
    const result2 = await tool.execute("call-async-query-2", {
      taskId: "agnes-async-task-456",
      engine: "agnes"
    });

    assert.equal(queryCount, 2);
    assert.equal(downloaded, true);
    assert.equal(result2.details.status, "completed");

    // Verify task is completed in DB
    const task = store.getTask("agnes-async-task-456");
    assert.equal(task?.status, "completed");
    assert.equal(task?.progress, 100);
    assert.ok(task?.videoPath);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool returns completed status immediately from SQLite without querying remote API", async () => {
  try {
    await fs.mkdir(mockCwd, { recursive: true });
    const store = new SqliteVideoTaskStore(testDbFile);
    // Clean up any stale records
    store.deleteTask("mock-completed-task-123");

    const ctx = getTestContext(undefined, undefined, store);
    const tool = createVideoGenerateTool(ctx);

    // Manually insert a completed task into the taskStore
    store.createTask("mock-completed-task-123", "agnes", "session-1", "A simple prompt", { outputName: "video.mp4" });
    store.updateTaskProgress("mock-completed-task-123", "completed", 100, join(mockCwd, "video.mp4"));

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("Error", { status: 500 });
    }) as typeof fetch;

    try {
      const result = await tool.execute("call-completed-direct", {
        taskId: "mock-completed-task-123",
        engine: "agnes"
      });

      assert.equal(result.details.status, "completed");
      assert.equal(result.details.videoPath, join(mockCwd, "video.mp4"));
      assert.equal(fetchCalled, false); // remote API was not called
    } finally {
      globalThis.fetch = originalFetch;
      store.deleteTask("mock-completed-task-123");
    }
  } finally {
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool converts local reference images to Base64 data URLs", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      requestPayload = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: "agnes-base64-task-123", status: "queued" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });
    
    // Create a local dummy file
    const localImagePath = join(mockCwd, "test_image.png");
    await fs.writeFile(localImagePath, Buffer.from("dummy-image-bytes"));

    const store = new SqliteVideoTaskStore(testDbFile);
    store.deleteTask("agnes-base64-task-123");

    const ctx = getTestContext({
      engines: {
        agnes: { enabled: true, apiKey: "agnes-test-key", model: "agnes-video-v2.0" },
        volcengine: { enabled: false, apiKey: "", model: "doubao-seedance-2.0" }
      }
    }, undefined, store);

    const tool = createVideoGenerateTool(ctx);

    const result = await tool.execute("call-local-image", {
      prompt: "Generate video from local image",
      engine: "agnes",
      images: ["test_image.png"]
    });

    assert.equal(result.details.status, "processing");
    assert.equal(result.details.taskId, "agnes-base64-task-123");
    
    // Check that it converted the local image to a Base64 data URL
    const expectedBase64 = `data:image/png;base64,${Buffer.from("dummy-image-bytes").toString("base64")}`;
    assert.equal(requestPayload.image, expectedBase64);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool throws an error immediately if a local reference image does not exist", async () => {
  try {
    await fs.mkdir(mockCwd, { recursive: true });
    
    const store = new SqliteVideoTaskStore(testDbFile);
    const ctx = getTestContext({
      engines: {
        agnes: { enabled: true, apiKey: "agnes-test-key", model: "agnes-video-v2.0" },
        volcengine: { enabled: false, apiKey: "", model: "doubao-seedance-2.0" }
      }
    }, undefined, store);

    const tool = createVideoGenerateTool(ctx);

    await assert.rejects(
      async () => {
        await tool.execute("call-missing-image", {
          prompt: "Generate video with missing image",
          engine: "agnes",
          images: ["non_existent_file.png"]
        });
      },
      (err: any) => {
        return err instanceof Error && err.message.includes("Local reference image file not found");
      }
    );
  } finally {
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

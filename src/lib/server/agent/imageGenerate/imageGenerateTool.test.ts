import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createImageGenerateTool } from "./imageGenerateTool.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const mockCwd = join(process.cwd(), ".test-tmp/imageGenerateTest");
const mockWorkspace = mockCwd;
const mockArtifactDir = "2026/06/04";

const defaultTestSettings: RuntimeSettings = {
  imageGenerate: {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: true, apiKey: "agnes-key" },
      modelscope: { enabled: false, apiKey: "" },
      google: { enabled: false, apiKey: "" },
      volcengine: { enabled: false, apiKey: "" }
    }
  }
} as unknown as RuntimeSettings;

function getTestContext(settingsPatch?: Partial<RuntimeSettings["imageGenerate"]>, uploadFile?: any) {
  const currentSettings = {
    ...defaultTestSettings,
    imageGenerate: {
      ...defaultTestSettings.imageGenerate,
      ...settingsPatch,
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        ...(settingsPatch?.engines || {})
      }
    }
  } as RuntimeSettings;

  return {
    getSettings: () => currentSettings,
    cwd: mockCwd,
    workspaceDir: mockWorkspace,
    artifactDir: mockArtifactDir,
    uploadFile
  };
}

test("imageGenerate tool successfully calls Agnes API and downloads image", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;
  let requestHeaders: any = null;
  let downloadedUrl = "";

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("/v1/images/generations")) {
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/generated-agnes.png" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("generated-agnes.png")) {
      downloadedUrl = cleanUrl;
      return new Response(Buffer.from("agnes-fake-png-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    let uploadedFile: string | null = null;
    let uploadedTitle: string | null = null;
    const uploadFile = async (filePath: string, title?: string) => {
      uploadedFile = filePath;
      uploadedTitle = title || null;
    };

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        agnes: { enabled: true, apiKey: "agnes-test-api-key", baseUrl: "https://custom.agnes.ai" }
      }
    }, uploadFile);

    const tool = createImageGenerateTool(ctx);
    const result = await tool.execute("call-1", {
      prompt: "A beautiful mountain",
      engine: "agnes",
      size: "1024x768",
      seed: 42,
      outputName: "agnes_mountain.png"
    });

    assert.ok(result.content[0].text.includes("Successfully generated image using 'agnes' engine."));
    assert.equal(requestPayload.prompt, "A beautiful mountain");
    assert.equal(requestPayload.size, "1024x768");
    assert.equal(requestPayload.seed, 42);
    assert.equal(requestHeaders["Authorization"], "Bearer agnes-test-api-key");
    assert.equal(downloadedUrl, "https://example.com/generated-agnes.png");

    const savedFilePath = join(mockCwd, mockArtifactDir, "agnes_mountain.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "agnes-fake-png-bytes");
    assert.equal(uploadedFile, savedFilePath);
    assert.equal(uploadedTitle, "agnes_mountain.png");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool successfully calls Google Imagen and saves base64 response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestPayload: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = String(url);
    requestPayload = JSON.parse(init?.body as string);
    // Return base64 for "google-fake-png-bytes" which is "Z29vZ2xlLWZha2UtcG5nLWJ5dGVz"
    return new Response(JSON.stringify({
      predictions: [{ bytesBase64Encoded: "Z29vZ2xlLWZha2UtcG5nLWJ5dGVz" }]
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        google: { enabled: true, apiKey: "google-test-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    const result = await tool.execute("call-2", {
      prompt: "A cyber cat",
      engine: "google",
      outputName: "google_cat.png"
    });

    assert.ok(result.content[0].text.includes("Successfully generated image using 'google' engine."));
    assert.ok(requestedUrl.includes("imagen-3.0-generate-001:predict?key=google-test-key"));
    assert.equal(requestPayload.instances[0].prompt, "A cyber cat");

    const savedFilePath = join(mockCwd, mockArtifactDir, "google_cat.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "google-fake-png-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool resolves auto engine correctly based on priority", async () => {
  const originalFetch = globalThis.fetch;
  let resolvedEngine: string | null = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("volcengine") || cleanUrl.includes("volces")) {
      resolvedEngine = "volcengine";
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/volc.png" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("volc.png")) {
      return new Response(Buffer.from("volc-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    // Enable only volcengine (which has higher priority than modelscope but lower than agnes and google)
    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "" },
        modelscope: { enabled: true, apiKey: "modelscope-key" },
        google: { enabled: false, apiKey: "" },
        volcengine: { enabled: true, apiKey: "volc-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await tool.execute("call-3", {
      prompt: "A futuristic city",
      engine: "auto",
      outputName: "auto_city.png"
    });

    // Priority is: agnes -> google -> volcengine -> modelscope.
    // Agnes and Google are disabled/lack key, so volcengine must be resolved instead of modelscope.
    assert.equal(resolvedEngine, "volcengine");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool prefers configured default engine before auto priority order", async () => {
  const originalFetch = globalThis.fetch;
  let resolvedEngine: string | null = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("generativelanguage.googleapis.com")) {
      resolvedEngine = "google";
      return new Response(JSON.stringify({
        predictions: [{ bytesBase64Encoded: "ZGVmYXVsdC1nb29nbGUtYnl0ZXM=" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("/v1/images/generations")) {
      resolvedEngine = "agnes";
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/agnes-default.png" }]
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      defaultEngine: "google",
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        agnes: { enabled: true, apiKey: "agnes-key" },
        google: { enabled: true, apiKey: "google-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await tool.execute("call-default-engine", {
      prompt: "A clean product icon",
      engine: "auto",
      outputName: "default_engine.png"
    });

    assert.equal(resolvedEngine, "google");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool handles ModelScope async task submission and polling correctly", async () => {
  const originalFetch = globalThis.fetch;
  let taskId = "ms-task-12345";
  let pollAttempts = 0;
  let downloadedBytes = "";

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    
    // Submit task
    if (cleanUrl.includes("/v1/images/generations")) {
      return new Response(JSON.stringify({ task_id: taskId }), { status: 200 });
    }
    
    // Poll task
    if (cleanUrl.includes(`/v1/tasks/${taskId}`)) {
      pollAttempts++;
      if (pollAttempts === 1) {
        // Return pending status first
        return new Response(JSON.stringify({ task_status: "PENDING" }), { status: 200 });
      } else {
        // Return success status on second poll
        return new Response(JSON.stringify({
          task_status: "SUCCEED",
          output_images: ["https://example.com/modelscope-final.png"]
        }), { status: 200 });
      }
    }
    
    // Download image
    if (cleanUrl.includes("modelscope-final.png")) {
      downloadedBytes = "modelscope-image-data";
      return new Response(Buffer.from(downloadedBytes));
    }
    
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        modelscope: { enabled: true, apiKey: "ms-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    const result = await tool.execute("call-4", {
      prompt: "A cute puppy",
      engine: "modelscope",
      outputName: "ms_puppy.png"
    });

    assert.ok(result.content[0].text.includes("Successfully generated image using 'modelscope' engine."));
    assert.equal(pollAttempts, 2); // Poll twice: PENDING, then SUCCEED
    
    const savedFilePath = join(mockCwd, mockArtifactDir, "ms_puppy.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "modelscope-image-data");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

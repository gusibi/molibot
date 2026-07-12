import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createImageGenerateTool } from "./imageGenerateTool.js";
import { SqliteImageTaskStore } from "./imageTaskStore.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const mockCwd = join(process.cwd(), ".test-tmp/imageGenerateTest");
const mockWorkspace = mockCwd;
const mockArtifactDir = "2026/06/04";
const testDbFile = join(mockCwd, "test_settings.sqlite");

const defaultTestSettings: RuntimeSettings = {
  imageGenerate: {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: true, apiKey: "agnes-key" },
      openai: { enabled: false, apiKey: "" },
      "openai-chat": { enabled: false, apiKey: "" },
      modelscope: { enabled: false, apiKey: "" },
      google: { enabled: false, apiKey: "" },
      volcengine: { enabled: false, apiKey: "" }
    }
  }
} as unknown as RuntimeSettings;

function getTestContext(settingsPatch?: Partial<RuntimeSettings["imageGenerate"]>, uploadFile?: any, taskStore?: any) {
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
    uploadFile,
    taskStore: taskStore || new SqliteImageTaskStore(testDbFile)
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
    assert.match(result.content[0].text, /Remote URL: https:\/\/example\.com\/generated-agnes\.png/);
    assert.equal(result.details.imageUrl, "https://example.com/generated-agnes.png");
    assert.equal(result.details.engineEnabled, true);
    assert.equal(result.details.providerEnabled, true);
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

    // Assert SQLite task database insertion and details
    const taskId = result.details.taskId;
    assert.ok(taskId);
    const taskRecord = ctx.taskStore.getTask(taskId);
    assert.ok(taskRecord);
    assert.equal(taskRecord.status, "completed");
    assert.equal(taskRecord.prompt, "A beautiful mountain");
    assert.equal(taskRecord.engine, "agnes");
    assert.equal(taskRecord.imagePath, savedFilePath);
    assert.equal(taskRecord.imageUrl, "https://example.com/generated-agnes.png");
    assert.equal(taskRecord.requestParams.engineEnabled, true);
    assert.equal(taskRecord.requestParams.providerEnabled, true);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool still returns generated image details when chat upload fails", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("/v1/images/generations")) {
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/upload-failed-image.png" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("upload-failed-image.png")) {
      return new Response(Buffer.from("image-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const uploadFile = async () => {
      throw new Error("Network request for 'sendDocument' failed!");
    };
    const ctx = getTestContext(undefined, uploadFile);
    const tool = createImageGenerateTool(ctx);

    const result = await tool.execute("call-upload-failed", {
      prompt: "A dancer in a studio",
      engine: "agnes",
      outputName: "upload_failed.png"
    });

    assert.ok(result.content[0].text.includes("Generated successfully, but automatic chat upload failed"));
    assert.match(result.content[0].text, /Remote URL: https:\/\/example\.com\/upload-failed-image\.png/);
    assert.match(result.content[0].text, /Upload error: Network request for 'sendDocument' failed!/);
    assert.equal(result.details.uploaded, false);
    assert.equal(result.details.uploadError, "Network request for 'sendDocument' failed!");

    const savedFilePath = join(mockCwd, mockArtifactDir, "upload_failed.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "image-bytes");
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

test("imageGenerate tool successfully calls OpenAI Images API and saves base64 response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestPayload: any = null;
  let requestHeaders: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = String(url);
    requestPayload = JSON.parse(init?.body as string);
    requestHeaders = init?.headers;
    return new Response(JSON.stringify({
      data: [{ b64_json: "b3BlbmFpLWZha2UtcG5nLWJ5dGVz" }]
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        openai: { enabled: true, apiKey: "openai-test-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    const result = await tool.execute("call-openai", {
      prompt: "A cyber cat",
      engine: "openai",
      outputName: "openai_cat.png"
    });

    assert.ok(result.content[0].text.includes("Successfully generated image using 'openai' engine."));
    assert.equal(requestedUrl, "https://api.openai.com/v1/images/generations");
    assert.equal(requestHeaders["Authorization"], "Bearer openai-test-key");
    assert.equal(requestPayload.model, "gpt-image-2");
    assert.equal(requestPayload.prompt, "A cyber cat");
    assert.equal(requestPayload.n, 1);

    const savedFilePath = join(mockCwd, mockArtifactDir, "openai_cat.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "openai-fake-png-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool successfully calls OpenAI Chat Completions format and downloads returned image URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestPayload: any = null;
  let requestHeaders: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("/v1/chat/completions")) {
      requestedUrl = cleanUrl;
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ image_url: "https://example.com/openai-chat-image.png" })
          }
        }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("openai-chat-image.png")) {
      return new Response(Buffer.from("openai-chat-image-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        "openai-chat": {
          enabled: true,
          apiKey: "openai-chat-test-key",
          baseUrl: "https://chat-compatible.example.com/v1",
          model: "chat-image-model"
        }
      }
    });

    const tool = createImageGenerateTool(ctx);
    const result = await tool.execute("call-openai-chat", {
      prompt: "A cyber cat",
      engine: "openai-chat",
      outputName: "openai_chat_cat.png"
    });

    assert.ok(result.content[0].text.includes("Successfully generated image using 'openai-chat' engine."));
    assert.equal(requestedUrl, "https://chat-compatible.example.com/v1/chat/completions");
    assert.equal(requestHeaders["Authorization"], "Bearer openai-chat-test-key");
    assert.equal(requestPayload.model, "chat-image-model");
    assert.equal(requestPayload.messages[0].role, "user");
    assert.match(requestPayload.messages[0].content, /A cyber cat/);
    assert.match(result.content[0].text, /Remote URL: https:\/\/example\.com\/openai-chat-image\.png/);

    const savedFilePath = join(mockCwd, mockArtifactDir, "openai_chat_cat.png");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "openai-chat-image-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool logs Google Imagen request and empty response with redacted key", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({}), { status: 200, statusText: "OK" });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        google: { enabled: true, apiKey: "google-secret-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await assert.rejects(
      async () => {
        await tool.execute("call-google-empty-response", {
          prompt: "A cyber cat",
          engine: "google",
          outputName: "google_empty.png"
        });
      },
      /Google Imagen API did not return image bytes/
    );

    const joined = logs.join("\n");
    assert.match(joined, /\[Agent Image Tool\] \[HTTP REQUEST\] URL: .*imagen-3\.0-generate-001:predict\?key=\.\.\.redacted/);
    assert.match(joined, /\[Agent Image Tool\] \[HTTP REQUEST BODY\]: .*A cyber cat/);
    assert.match(joined, /\[Agent Image Tool\] \[HTTP RESPONSE\] Status: 200 OK/);
    assert.match(joined, /\[Agent Image Tool\] \[HTTP RESPONSE BODY\]: \{\}/);
    assert.doesNotMatch(joined, /google-secret-key/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate tool rejects a requested engine when it is disabled even with an API key", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        google: { enabled: false, apiKey: "google-disabled-key" }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await assert.rejects(
      async () => {
        await tool.execute("call-disabled-google", {
          prompt: "A cyber cat",
          engine: "google",
          outputName: "disabled_google.png"
        });
      },
      /not enabled or lacks an API key/
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
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

    // Enable only volcengine (which has higher priority than modelscope but lower than agnes, openai, openai-chat, and google)
    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "" },
        openai: { enabled: false, apiKey: "" },
        "openai-chat": { enabled: false, apiKey: "" },
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

    // Priority is: agnes -> openai -> openai-chat -> google -> volcengine -> modelscope.
    // Agnes, OpenAI, OpenAI Chat, and Google are disabled/lack key, so volcengine must be resolved instead of modelscope.
    assert.equal(resolvedEngine, "volcengine");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("imageGenerate sends reference image URL to Volcengine as a string, not an array", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("ark.cn-beijing.volces.com")) {
      requestPayload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/volc-reference.png" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("volc-reference.png")) {
      return new Response(Buffer.from("volc-reference-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });
    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        agnes: { enabled: false, apiKey: "" },
        volcengine: {
          enabled: true,
          apiKey: "volc-key",
          model: "doubao-seedream-5-0-lite"
        }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await tool.execute("call-volc-reference", {
      prompt: "Keep the same Momo character in a clean office scene",
      engine: "volcengine",
      images: [
        "https://assets.example.com/momo-model-sheet.png",
        "https://assets.example.com/momo-expression-sheet.png"
      ],
      size: "1920x2560",
      outputName: "volc_reference.png"
    });

    assert.ok(requestPayload);
    assert.equal(requestPayload.image, "https://assets.example.com/momo-model-sheet.png");
    assert.equal(requestPayload.model, "doubao-seedream-5-0-lite");
    assert.equal(requestPayload.size, "1920x2560");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(mockCwd, { recursive: true, force: true });
  }
});

test("imageGenerate normalizes JSON-stringified images array from LLM before sending to Volcengine", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.includes("ark.cn-beijing.volces.com")) {
      requestPayload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        data: [{ url: "https://example.com/volc-json-string.png" }]
      }), { status: 200 });
    }
    if (cleanUrl.includes("volc-json-string.png")) {
      return new Response(Buffer.from("volc-json-string-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });
    const ctx = getTestContext({
      engines: {
        ...defaultTestSettings.imageGenerate.engines,
        agnes: { enabled: false, apiKey: "" },
        volcengine: {
          enabled: true,
          apiKey: "volc-key",
          model: "doubao-seedream-5-0-lite"
        }
      }
    });

    const tool = createImageGenerateTool(ctx);
    await tool.execute("call-volc-json-string", {
      prompt: "Keep Momo character",
      engine: "volcengine",
      // LLM sometimes passes arrays as JSON strings instead of real arrays
      images: "[\"https://molibot-r2.eztoolab.com/momo-agent/02-avatars/happy.png\"]",
      size: "1024x1280",
      outputName: "volc_json_string.png"
    });

    assert.ok(requestPayload);
    assert.equal(
      requestPayload.image,
      "https://molibot-r2.eztoolab.com/momo-agent/02-avatars/happy.png"
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(mockCwd, { recursive: true, force: true });
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
    assert.match(result.content[0].text, /Remote URL: https:\/\/example\.com\/modelscope-final\.png/);
    assert.equal(result.details.imageUrl, "https://example.com/modelscope-final.png");
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

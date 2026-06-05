import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVideoGenerateTool } from "./videoGenerateTool.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const mockCwd = join(process.cwd(), ".test-tmp/videoGenerateTest");
const mockWorkspace = mockCwd;
const mockArtifactDir = "2026/06/05";

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

function getTestContext(settingsPatch?: Partial<RuntimeSettings["videoGenerate"]>, uploadFile?: any) {
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
    uploadFile
  };
}

test("videoGenerate tool successfully calls Agnes API and downloads video", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;
  let requestHeaders: any = null;
  let pollHeaders: any = null;
  let downloadedUrl = "";
  let pollAttempts = 0;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.endsWith("/v1/videos")) {
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        id: "agnes-task-123",
        status: "queued"
      }), { status: 200 });
    }
    if (cleanUrl.includes("/v1/videos/agnes-task-123")) {
      pollAttempts++;
      pollHeaders = init?.headers;
      if (pollAttempts === 1) {
        return new Response(JSON.stringify({ status: "in_progress" }), { status: 200 });
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
    }, uploadFile);

    const tool = createVideoGenerateTool(ctx);
    const result = await tool.execute("call-1", {
      prompt: "A beautiful mountain river flow",
      engine: "agnes",
      duration: 5,
      ratio: "16:9",
      seed: 42,
      outputName: "agnes_river.mp4"
    });

    assert.ok(result.content[0].text.includes("Successfully generated video using 'agnes' engine."));
    assert.equal(requestPayload.prompt, "A beautiful mountain river flow");
    assert.equal(requestPayload.model, "agnes-video-v2.0-custom");
    assert.equal(requestPayload.num_frames, 121);
    assert.equal(requestPayload.frame_rate, 24);
    assert.equal(requestPayload.width, 1280);
    assert.equal(requestPayload.height, 720);
    assert.equal(requestPayload.seed, 42);
    assert.equal(requestHeaders["Authorization"], "Bearer agnes-test-api-key");
    assert.equal(pollHeaders["Authorization"], "Bearer agnes-test-api-key");
    assert.equal(pollAttempts, 2);
    assert.equal(downloadedUrl, "https://example.com/generated-agnes.mp4");

    const savedFilePath = join(mockCwd, mockArtifactDir, "agnes_river.mp4");
    const fileBytes = await fs.readFile(savedFilePath, "utf8");
    assert.equal(fileBytes, "agnes-fake-mp4-bytes");
    assert.equal(uploadedFile, savedFilePath);
    assert.equal(uploadedTitle, "agnes_river.mp4");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

test("videoGenerate tool successfully calls Volcengine API and downloads video", async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload: any = null;
  let requestHeaders: any = null;
  let downloadedUrl = "";
  let pollAttempts = 0;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const cleanUrl = String(url);
    if (cleanUrl.endsWith("/api/plan/v3/contents/generations/tasks")) {
      requestPayload = JSON.parse(init?.body as string);
      requestHeaders = init?.headers;
      return new Response(JSON.stringify({
        id: "cgt-task-999"
      }), { status: 200 });
    }
    if (cleanUrl.includes("/api/plan/v3/contents/generations/tasks/cgt-task-999")) {
      pollAttempts++;
      if (pollAttempts === 1) {
        return new Response(JSON.stringify({ status: "running" }), { status: 200 });
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

    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "", model: "agnes-video-v2.0" },
        volcengine: { enabled: true, apiKey: "volc-test-key", model: "doubao-seedance-2.0-custom" }
      }
    });

    const tool = createVideoGenerateTool(ctx);
    const result = await tool.execute("call-2", {
      prompt: "A girl hugging a fox",
      engine: "volcengine",
      duration: 5,
      ratio: "adaptive",
      images: ["https://example.com/fox.png"],
      generateAudio: true,
      watermark: false,
      outputName: "volc_fox.mp4"
    });

    assert.ok(result.content[0].text.includes("Successfully generated video using 'volcengine' engine."));
    assert.equal(requestPayload.content[0].text, "A girl hugging a fox");
    assert.equal(requestPayload.content[1].image_url.url, "https://example.com/fox.png");
    assert.equal(requestPayload.model, "doubao-seedance-2.0-custom");
    assert.equal(requestPayload.generate_audio, true);
    assert.equal(requestPayload.watermark, false);
    assert.equal(requestPayload.ratio, "adaptive");
    assert.equal(requestPayload.duration, 5);
    assert.equal(requestHeaders["Authorization"], "Bearer volc-test-key");
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
    if (cleanUrl.includes("volc-123")) {
      return new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://example.com/volc.mp4" } }), { status: 200 });
    }
    if ((cleanUrl.includes("volces") || cleanUrl.includes("volcengine")) && !cleanUrl.includes("volc-123")) {
      resolvedEngine = "volcengine";
      return new Response(JSON.stringify({ id: "volc-123" }), { status: 200 });
    }
    if (cleanUrl.includes("volc.mp4")) {
      return new Response(Buffer.from("volc-bytes"));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    await fs.mkdir(mockCwd, { recursive: true });

    const ctx = getTestContext({
      engines: {
        agnes: { enabled: false, apiKey: "", model: "agnes-video-v2.0" },
        volcengine: { enabled: true, apiKey: "volc-key", model: "doubao-seedance-2.0" }
      }
    });

    const tool = createVideoGenerateTool(ctx);
    await tool.execute("call-3", {
      prompt: "A cute panda eating bamboo",
      engine: "auto",
      outputName: "auto_panda.mp4"
    });

    assert.equal(resolvedEngine, "volcengine");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await fs.rm(mockCwd, { recursive: true, force: true });
    } catch {}
  }
});

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { basename } from "node:path";
import { VIDEO_GENERATE_PROVIDERS, submitVideoTask, queryVideoTaskStatus } from "./providers.js";
import type { VideoGenerateEngine, VideoGenerateInput } from "./types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { SqliteVideoTaskStore } from "./videoTaskStore.js";
import { describeFileToolResult, type RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";

const videoGenerateSchema = Type.Object({
  prompt: Type.Optional(Type.String({
    description: [
      "Detailed description of the video to generate. Required when submitting a new generation task.",
      "Example: 'A young astronaut walking across a red desert planet, slow cinematic tracking shot, dramatic sunset lighting'"
    ].join(" ")
  })),
  engine: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("agnes"),
    Type.Literal("volcengine")
  ], {
    description: "The video generation engine. Defaults to 'auto' (automatically selects an enabled engine)."
  })),
  model: Type.Optional(Type.String({
    description: "Optional model ID override. Use only if a specific model variant is required."
  })),
  duration: Type.Optional(Type.Number({
    description: "Optional video duration in seconds."
  })),
  ratio: Type.Optional(Type.Union([
    Type.Literal("16:9"),
    Type.Literal("9:16"),
    Type.Literal("4:3"),
    Type.Literal("3:4"),
    Type.Literal("1:1"),
    Type.Literal("21:9"),
    Type.Literal("adaptive")
  ], {
    description: "Optional video aspect ratio. Defaults to engine-specific defaults."
  })),
  seed: Type.Optional(Type.Number({
    description: "Random seed to guarantee reproducible outputs."
  })),
  images: Type.Optional(Type.Union([
    Type.Array(Type.String()),
    Type.String()
  ], {
    description: "Optional public HTTP(S) Remote URL image references for image-to-video or transitions. Accepts an array, a single string, or a JSON-stringified array. Use the Remote URL returned by imageGenerate. Never pass Base64, data URLs, local file paths, or Absolute path values."
  })),
  generateAudio: Type.Optional(Type.Boolean({
    description: "Optional flag to generate audio for the video (supported by Volcengine). Defaults to true."
  })),
  watermark: Type.Optional(Type.Boolean({
    description: "Optional flag to include an AI watermark. Defaults to false."
  })),
  outputName: Type.Optional(Type.String({
    description: "Suggested filename to save the video under (e.g. city.mp4). If not provided, a unique filename is generated."
  })),

  // Asynchronous flow parameters:
  taskId: Type.Optional(Type.String({
    description: "If provided, queries the status/progress of an existing generation task instead of submitting a new one. The 'engine' parameter must also be supplied."
  }))
});

function buildVideoGenerateDescription(settings: RuntimeSettings): string {
  return [
    "- Generates high-quality cinematic videos using configured Cloud APIs (Agnes, Volcengine).",
    "- Auto-saves the generated video locally to your dated scratch directory or a custom path.",
    "- Automatically uploads and displays the video to the chat interface so the user sees it immediately.",
    "- This tool is asynchronous and non-blocking: submitting a task returns a taskId immediately.",
    "- Call this tool with the taskId and engine to query the status of a running task.",
    "",
    "Usage guidelines:",
    "- Use when the user asks to generate a video, animate reference pictures, create a movie clip, or query the status of a running video task.",
    "- If you have reference images, pass public HTTP(S) Remote URLs in the `images` array. If the image came from `imageGenerate`, use its `Remote URL`, not its local path. Never pass Base64, data URLs, local file paths, or `Absolute path` values.",
    "- When submitting a task, you will receive a taskId. You must immediately inform the user of this taskId and end your turn.",
    "- Do not loop or call this tool repeatedly in the same turn. Wait for the user to ask for progress before querying again."
  ].join("\n");
}

function resolveEngine(settings: RuntimeSettings["videoGenerate"], requested?: string): VideoGenerateEngine {
  if (requested && requested !== "auto") {
    const engineId = requested as VideoGenerateEngine;
    const config = settings.engines[engineId];
    if (config?.enabled && config.apiKey.trim()) {
      return engineId;
    }
    throw new Error(`Requested video generation engine '${engineId}' is not enabled or lacks an API key.`);
  }

  const defaultEngine = settings.defaultEngine;
  const priorityList: VideoGenerateEngine[] = defaultEngine && defaultEngine !== "auto"
    ? [defaultEngine, "agnes", "volcengine"]
    : ["agnes", "volcengine"];
  const seen = new Set<VideoGenerateEngine>();
  for (const engineId of priorityList) {
    if (seen.has(engineId)) continue;
    seen.add(engineId);
    const config = settings.engines[engineId];
    if (config?.enabled && config.apiKey.trim()) {
      return engineId;
    }
  }

  throw new Error(
    "No video generation engine is enabled. Please configure at least one API key: " +
    "AGNES_API_KEY or VOLCENGINE_API_KEY."
  );
}

function normalizeImageInputs(input: unknown): string[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.map(value => String(value).trim()).filter(Boolean);
  }
  const text = String(input).trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(value => String(value).trim()).filter(Boolean);
    }
  } catch {
    // Treat non-JSON strings as a single image path/URL.
  }
  return [text];
}

function assertPublicImageUrls(images: string[]): string[] {
  return images.map((image) => {
    const trimmed = image.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^data:/i.test(trimmed)) {
      throw new Error("Video reference images must be public HTTP(S) URLs. Agnes Video does not accept Base64/data URL images; use the Remote URL returned by imageGenerate.");
    }
    throw new Error(`Video reference image must be a public HTTP(S) URL, not a local path: ${trimmed}. Use the Remote URL returned by imageGenerate.`);
  });
}

function parseTaskUpdatedAt(updatedAt: string): number {
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshTaskRecord(updatedAt: string, maxAgeMs = 30_000): boolean {
  const parsed = parseTaskUpdatedAt(updatedAt);
  return parsed > 0 && Date.now() - parsed <= maxAgeMs;
}

function sanitizeRequestHeaders(headers: RequestInit["headers"]): Record<string, string> | string | undefined {
  if (!headers) return undefined;
  const maskValue = (key: string, value: unknown) => {
    const text = String(value ?? "");
    return /authorization|api[-_]?key|token|secret/i.test(key)
      ? text.replace(/^(Bearer\s+)?(.{0,6}).*$/i, (_match, prefix = "", start = "") => `${prefix}${start}...redacted`)
      : text;
  };

  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()).map(([key, value]) => [key, maskValue(key, value)]));
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, maskValue(key, value)]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, maskValue(key, value)]));
}

function formatCompletedTaskText(taskId: string, videoUrl?: string, videoPath?: string, uploadedMessage = ""): string {
  const lines = [`Video generation task '${taskId}' is completed.${uploadedMessage}`];
  if (videoUrl) {
    lines.push(`Remote URL: ${videoUrl}`);
  }
  if (videoPath) {
    lines.push(`Local path: ${videoPath}`);
  }
  if (!videoUrl && !videoPath) {
    lines.push("Video URL: unknown");
  }
  return lines.join("\n");
}

export function createVideoGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  outputLayout?: RunOutputLayout;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  sessionId?: string;
  taskStore?: SqliteVideoTaskStore;
}): AgentTool<typeof videoGenerateSchema> {
  const settings = options.getSettings();
  const taskStore = options.taskStore || new SqliteVideoTaskStore();
  const sessionId = options.sessionId || "default";

  return {
    name: "videoGenerate",
    label: "videoGenerate",
    description: buildVideoGenerateDescription(settings),
    parameters: videoGenerateSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal): Promise<any> => {
      const currentSettings = options.getSettings();
      if (!currentSettings.videoGenerate.enabled) {
        throw new Error("Video generation tool is disabled in settings.");
      }

      const loggingFetch = async (url: string, init?: RequestInit) => {
        console.log(`[Agent Video Tool] [HTTP REQUEST] URL: ${url}`);
        if (init?.headers) {
          console.log(`[Agent Video Tool] [HTTP REQUEST HEADERS]:`, JSON.stringify(sanitizeRequestHeaders(init.headers)));
        }
        if (init?.body) {
          console.log(`[Agent Video Tool] [HTTP REQUEST BODY]: ${init.body}`);
        }
        try {
          const response = await globalThis.fetch(url, init);
          let text = "";
          try {
            text = await response.clone().text();
          } catch (bodyError) {
            text = `[failed to read response body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}]`;
          }
          console.log(`[Agent Video Tool] [HTTP RESPONSE] Status: ${response.status} ${response.statusText || ""}`.trim());
          console.log(`[Agent Video Tool] [HTTP RESPONSE BODY]: ${text.slice(0, 2000) || "(empty)"}`);
          return response;
        } catch (err) {
          console.error(`[Agent Video Tool] [HTTP FETCH ERROR]:`, err);
          throw err;
        }
      };

      // --- BRANCH A: QUERYING PROGRESS OF AN EXISTING TASK (Non-blocking: queries status exactly once) ---
      if (params.taskId) {
        const taskId = params.taskId.trim();
        const engine = params.engine as VideoGenerateEngine;
        if (!engine || engine === "auto") {
          throw new Error("The 'engine' parameter must be specified when querying a task by taskId.");
        }

        const taskRecord = taskStore.getTask(taskId);
        if (!taskRecord) {
          throw new Error(`Video task with ID '${taskId}' was not found in the task store.`);
        }

        const videoId = taskRecord.pollParams?.videoId;

        // If the task has already been completed or failed (e.g. by the background Svelte poller),
        // return the local state immediately without making redundant third-party API queries.
        if (taskRecord.status === "completed") {
          let uploadedMessage = "";
          const filePath = taskRecord.videoPath;
          if (filePath && options.uploadFile) {
            const title = basename(filePath);
            const text = `Completed video: ${taskRecord.prompt}`;
            await options.uploadFile(filePath, title, text);
            uploadedMessage = " (Automatically uploaded and sent to chat channel)";
          }
          return {
            content: [{
              type: "text",
              text: formatCompletedTaskText(taskId, taskRecord.videoUrl, filePath, uploadedMessage)
            }],
            details: {
              ...(filePath && options.outputLayout
                ? describeFileToolResult(options.outputLayout, filePath, "generated", taskRecord.pollParams?.outputName)
                : {}),
              status: "completed",
              progress: 100,
              taskId,
              engine,
              videoUrl: taskRecord.videoUrl,
              videoPath: filePath
            }
          };
        }

        if (taskRecord.status === "failed") {
          return {
            content: [{
              type: "text",
              text: `Video generation task '${taskId}' failed: ${taskRecord.errorMessage || "Unknown error"}`
            }],
            details: {
              status: "failed",
              progress: 0,
              taskId,
              engine,
              error: taskRecord.errorMessage
            }
          };
        }

        if (isFreshTaskRecord(taskRecord.updatedAt)) {
          return {
            content: [{
              type: "text",
              text: `Video generation task '${taskId}' is still processing. Current progress: ${taskRecord.progress}%.`
            }],
            details: {
              status: "processing",
              taskId,
              engine,
              progress: taskRecord.progress,
              cached: true
            }
          };
        }

        const providerContext = {
          settings: currentSettings.videoGenerate,
          fetch: loggingFetch,
          signal
        };

        let res;
        try {
          res = await queryVideoTaskStatus(taskId, engine, providerContext, videoId);
        } catch (err: any) {
          const errMsg = err.message || String(err);
          taskStore.updateTaskProgress(taskId, "failed", 0, undefined, `Query failed: ${errMsg}`);
          throw err;
        }

        if (res.status === "completed") {
          taskStore.updateTaskProgress(taskId, "completed", 100, undefined, undefined, res.videoUrl);

          return {
            content: [{
              type: "text",
              text: formatCompletedTaskText(taskId, res.videoUrl)
            }],
            details: {
              status: "completed",
              taskId,
              engine,
              videoUrl: res.videoUrl
            }
          };
        } else if (res.status === "failed") {
          const err = res.error || "Unknown provider generation failure";
          taskStore.updateTaskProgress(taskId, "failed", 0, undefined, err);
          return {
            content: [{
              type: "text",
              text: `Video generation task '${taskId}' failed: ${err}`
            }],
            details: {
              status: "failed",
              taskId,
              engine,
              error: err
            }
          };
        } else {
          // Still processing
          const progress = res.progress ?? 0;
          taskStore.updateTaskProgress(taskId, "processing", progress);
          return {
            content: [{
              type: "text",
              text: `Video generation task '${taskId}' is still processing. Current progress: ${progress}%.`
            }],
            details: {
              status: "processing",
              taskId,
              engine,
              progress
            }
          };
        }
      }

      // --- BRANCH B: SUBMITTING A NEW TASK (Always returns immediately with taskId) ---
      const inputPrompt = String(params.prompt || "").trim();
      if (!inputPrompt) {
        throw new Error("Prompt is required when starting a new video generation task.");
      }

      // 1. Resolve engine
      const engine = resolveEngine(currentSettings.videoGenerate, params.engine);

      // 2. Resolve output path
      const outName = String(params.outputName || "").trim() || `video_${Date.now()}.mp4`;

      const providerContext = {
        settings: currentSettings.videoGenerate,
        fetch: loggingFetch,
        signal
      };

      // Video providers require public image URLs; do not submit local paths or Base64 data URLs.
      let resolvedImages: string[] | undefined = undefined;
      const imageInputs = normalizeImageInputs(params.images);
      if (imageInputs.length > 0) {
        resolvedImages = assertPublicImageUrls(imageInputs);
      }

      const providerInput: VideoGenerateInput = {
        prompt: inputPrompt,
        engine,
        model: params.model,
        duration: params.duration,
        ratio: params.ratio,
        seed: params.seed,
        images: resolvedImages,
        generateAudio: params.generateAudio,
        watermark: params.watermark,
        outputName: outName
      };

      // 3. Submit Task
      const { taskId, pollParams } = await submitVideoTask(providerInput, providerContext);

      // Add outputName to pollParams to recall it during download step
      const finalPollParams = { ...pollParams, outputName: outName };

      // Save to SQLite
      taskStore.createTask(taskId, engine, sessionId, inputPrompt, finalPollParams);

      return {
        content: [{
          type: "text",
          text: `Successfully submitted video generation task using '${engine}' engine.\nTask ID: ${taskId}\nChecking progress will start shortly.`
        }],
        details: {
          status: "processing",
          taskId,
          engine,
          progress: 0,
          prompt: inputPrompt
        }
      };
    }
  };
}

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { promises as fs, existsSync } from "node:fs";
import { dirname, basename, extname, relative, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { VIDEO_GENERATE_PROVIDERS, submitVideoTask, queryVideoTaskStatus } from "./providers.js";
import type { VideoGenerateEngine, VideoGenerateInput } from "./types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { SqliteVideoTaskStore } from "./videoTaskStore.js";

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
  images: Type.Optional(Type.Array(Type.String(), {
    description: "Optional URLs of input/reference images for image-to-video or transitions."
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

function routeDefaultArtifactPath(inputPath: string, artifactDir?: string): { requestedPath: string; path: string; routed: boolean } {
  const requestedPath = inputPath.trim();
  const normalizedArtifactDir = artifactDir?.trim();
  if (!normalizedArtifactDir || !requestedPath || /^\/|^[A-Za-z]:/.test(requestedPath)) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  const normalizedPath = requestedPath.replaceAll("\\", "/").replace(/^\.\//, "");
  const isPlainFileName =
    normalizedPath &&
    !normalizedPath.includes("/") &&
    !normalizedPath.startsWith(".") &&
    normalizedPath !== "..";
  if (!isPlainFileName) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  return {
    requestedPath,
    path: `${normalizedArtifactDir}/${normalizedPath}`,
    routed: true
  };
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif"
};

function isRemoteOrDataUrl(url: string): boolean {
  return /^(https?:\/\/|data:)/i.test(url.trim());
}

async function processLocalImage(
  imgPath: string,
  cwd: string,
  ensureAllowedPath: (path: string) => void
): Promise<string> {
  const trimmed = imgPath.trim();
  if (isRemoteOrDataUrl(trimmed)) {
    return trimmed;
  }

  // Resolve to absolute path
  const absPath = resolveToolPath(cwd, trimmed);

  // Check if file exists
  if (!existsSync(absPath)) {
    throw new Error(`Local reference image file not found: ${trimmed}`);
  }

  // Verify path safety: must be allowed by path guard OR inside system temporary directories
  const resolved = resolve(absPath);
  const tempDir = resolve(tmpdir());
  const relTemp = relative(tempDir, resolved);
  const isInsideTemp = relTemp === "" || (!relTemp.startsWith("..") && !isAbsolute(relTemp));
  
  const relTmp = relative("/tmp", resolved);
  const isInsideTmp = relTmp === "" || (!relTmp.startsWith("..") && !isAbsolute(relTmp));

  if (!isInsideTemp && !isInsideTmp) {
    ensureAllowedPath(resolved);
  }

  // Read file and convert to Base64 Data URL
  try {
    const bytes = await fs.readFile(resolved);
    const ext = extname(resolved).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext] || "image/png";
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch (err: any) {
    throw new Error(`Failed to read local image file at '${trimmed}': ${err.message}`);
  }
}

export function createVideoGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  sessionId?: string;
  taskStore?: SqliteVideoTaskStore;
}): AgentTool<typeof videoGenerateSchema> {
  const settings = options.getSettings();
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
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
          console.log(`[Agent Video Tool] [HTTP REQUEST HEADERS]:`, JSON.stringify(init.headers));
        }
        if (init?.body) {
          console.log(`[Agent Video Tool] [HTTP REQUEST BODY]: ${init.body}`);
        }
        try {
          const response = await globalThis.fetch(url, init);
          const cloned = response.clone();
          const text = await cloned.text();
          console.log(`[Agent Video Tool] [HTTP RESPONSE] Status: ${response.status}, Body: ${text.slice(0, 500)}`);
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
              text: `Video generation task '${taskId}' is completed.${uploadedMessage}\nSaved file to: ${filePath || "unknown"}`
            }],
            details: {
              status: "completed",
              progress: 100,
              taskId,
              engine,
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
          // Download video
          const downloadResponse = await globalThis.fetch(res.videoUrl!, { signal });
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download generated video from url: ${downloadResponse.statusText}`);
          }
          const ab = await downloadResponse.arrayBuffer();
          const videoBuffer = Buffer.from(ab);

          // Resolve target path (retrieve original requested outputName from pollParams if possible)
          const outName = taskRecord.pollParams?.outputName || taskRecord.prompt.slice(0, 15).replace(/[^a-zA-Z0-9]/g, "_") + `_${Date.now()}.mp4`;
          const target = routeDefaultArtifactPath(outName, options.artifactDir);
          const filePath = resolveToolPath(options.cwd, target.path);
          ensureAllowedPath(filePath);

          // Write to File
          const dir = dirname(filePath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, videoBuffer);

          // Automatically upload
          let uploadedMessage = "";
          if (options.uploadFile) {
            const title = basename(filePath);
            const text = `Completed video: ${taskRecord.prompt}`;
            await options.uploadFile(filePath, title, text);
            uploadedMessage = " (Automatically uploaded and sent to chat channel)";
          }

          taskStore.updateTaskProgress(taskId, "completed", 100, filePath);

          return {
            content: [{
              type: "text",
              text: `Successfully completed video generation task '${taskId}'.${uploadedMessage}\nSaved file to: ${target.path}`
            }],
            details: {
              status: "completed",
              taskId,
              engine,
              path: target.path,
              filePath,
              uploaded: !!options.uploadFile
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

      // Resolve reference images (convert local paths to Base64 data URLs)
      let resolvedImages: string[] | undefined = undefined;
      if (params.images && params.images.length > 0) {
        resolvedImages = [];
        for (const img of params.images) {
          const base64Url = await processLocalImage(img, options.cwd, ensureAllowedPath);
          resolvedImages.push(base64Url);
        }
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

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { promises as fs } from "node:fs";
import { dirname, basename } from "node:path";
import { VIDEO_GENERATE_PROVIDERS } from "./providers.js";
import type { VideoGenerateEngine, VideoGenerateInput } from "./types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";

const videoGenerateSchema = Type.Object({
  prompt: Type.String({
    description: [
      "Detailed description of the video to generate.",
      "For best results, include subject, action, camera movement, lighting, and style parameters.",
      "Example: 'A young astronaut walking across a red desert planet, dust blowing in the wind, slow cinematic tracking shot, dramatic sunset lighting, realistic sci-fi style'"
    ].join(" ")
  }),
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
    description: "Optional video duration in seconds. Agnes supports sizes mapped from duration. Volcengine supports [4, 15] or -1 for smart auto duration."
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
    description: "Optional URLs of input/reference images for image-to-video or multi-image transition."
  })),
  generateAudio: Type.Optional(Type.Boolean({
    description: "Optional flag to generate audio for the video (supported by Volcengine/doubao). Defaults to true."
  })),
  watermark: Type.Optional(Type.Boolean({
    description: "Optional flag to include an AI watermark. Defaults to false."
  })),
  outputName: Type.Optional(Type.String({
    description: "Suggested filename to save the video under (e.g. city.mp4). If not provided, a unique filename is generated."
  }))
});

function buildVideoGenerateDescription(settings: RuntimeSettings): string {
  return [
    "- Generates high-quality cinematic videos using configured Cloud APIs (Agnes, Volcengine).",
    "- Auto-saves the generated video locally to your dated scratch directory or a custom path.",
    "- Automatically uploads and displays the video to the chat interface so the user sees it immediately. Do not call `attach` manually after using this tool.",
    "",
    "Usage guidelines:",
    "- Use when the user asks to generate a video, animate reference pictures, create a movie clip, or create video keyframe transitions.",
    "- For best quality, use descriptive English prompts containing: [Subject] + [Action] + [Scene] + [Camera Movement] + [Lighting] + [Style].",
    "- If you have reference images, pass their URLs in the `images` array."
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

export function createVideoGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
}): AgentTool<typeof videoGenerateSchema> {
  const settings = options.getSettings();
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

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

      const inputPrompt = String(params.prompt || "").trim();
      if (!inputPrompt) {
        throw new Error("Prompt is required.");
      }

      // 1. Resolve engine
      const engine = resolveEngine(currentSettings.videoGenerate, params.engine);

      // 2. Resolve output path
      const outName = String(params.outputName || "").trim() || `video_${Date.now()}.mp4`;
      const target = routeDefaultArtifactPath(outName, options.artifactDir);
      const filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);

      // 3. Execute provider
      const provider = VIDEO_GENERATE_PROVIDERS[engine];
      if (!provider) {
        throw new Error(`Provider not implemented for engine '${engine}'`);
      }

      const providerInput: VideoGenerateInput = {
        prompt: inputPrompt,
        engine,
        model: params.model,
        duration: params.duration,
        ratio: params.ratio,
        seed: params.seed,
        images: params.images,
        generateAudio: params.generateAudio,
        watermark: params.watermark,
        outputName: outName
      };

      const providerContext = {
        settings: currentSettings.videoGenerate,
        fetch: globalThis.fetch,
        signal
      };

      const result = await provider.generate(providerInput, providerContext);

      // 4. Resolve Video Buffer
      let videoBuffer: Buffer;
      if (result.videoBuffer) {
        videoBuffer = result.videoBuffer;
      } else if (result.videoUrl) {
        const downloadResponse = await globalThis.fetch(result.videoUrl, { signal });
        if (!downloadResponse.ok) {
          throw new Error(`Failed to download generated video from url: ${downloadResponse.statusText}`);
        }
        const ab = await downloadResponse.arrayBuffer();
        videoBuffer = Buffer.from(ab);
      } else {
        throw new Error("Provider returned no video source (URL or Buffer).");
      }

      // 5. Write to File
      const dir = dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, videoBuffer);

      // 6. Automatically upload / attach if capability is available
      let uploadedMessage = "";
      if (options.uploadFile) {
        const title = basename(filePath);
        const text = `Generated video: ${inputPrompt}`;
        await options.uploadFile(filePath, title, text);
        uploadedMessage = " (Automatically uploaded and sent to chat channel)";
      }

      return {
        content: [{
          type: "text",
          text: `Successfully generated video using '${engine}' engine.${uploadedMessage}\nSaved file to: ${target.path}`
        }],
        details: {
          engine,
          model: providerInput.model || currentSettings.videoGenerate.engines[engine]?.model || "default",
          prompt: inputPrompt,
          path: target.path,
          filePath,
          uploaded: !!options.uploadFile
        }
      };
    }
  };
}

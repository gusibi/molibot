import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { promises as fs } from "node:fs";
import { dirname, basename } from "node:path";
import crypto from "node:crypto";
import { IMAGE_GENERATE_PROVIDERS } from "./providers.js";
import type { ImageGenerateEngine, ImageGenerateInput } from "./types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { SqliteImageTaskStore } from "./imageTaskStore.js";

const imageGenerateSchema = Type.Object({
  prompt: Type.String({
    description: [
      "Detailed description of the image to generate.",
      "For best results, include style, composition, lighting, and quality parameters.",
      "Example: 'A cybernetic cat on a clean white background, studio lighting, sharp details, commercial photography style.'"
    ].join(" ")
  }),
  engine: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("agnes"),
    Type.Literal("openai"),
    Type.Literal("openai-chat"),
    Type.Literal("modelscope"),
    Type.Literal("google"),
    Type.Literal("volcengine")
  ], {
    description: "The image generation engine. Defaults to 'auto' (automatically selects an enabled engine)."
  })),
  model: Type.Optional(Type.String({
    description: "Optional model ID override. Use only if a specific model variant is required."
  })),
  size: Type.Optional(Type.String({
    description: "Output image dimensions, e.g. 1024x1024, 1024x768, 768x1024. Defaults to engine-specific defaults."
  })),
  seed: Type.Optional(Type.Number({
    description: "Random seed to guarantee reproducible outputs."
  })),
  images: Type.Optional(Type.Array(Type.String(), {
    description: "Optional URLs of input/reference images for image-to-image or multi-image composition."
  })),
  outputName: Type.Optional(Type.String({
    description: "Suggested filename to save the image under (e.g. cat.png). If not provided, a unique filename is generated."
  }))
});

function buildImageGenerateDescription(settings: RuntimeSettings): string {
  return [
    "- Generates high-quality images using configured Cloud APIs (Agnes, OpenAI Images, OpenAI-compatible Chat Completions, Google Imagen, Volcengine, ModelScope).",
    "- Auto-saves the generated image locally to your dated scratch directory or a custom path.",
    "- Automatically uploads and displays the image to the chat interface so the user sees it immediately. Do not call `attach` manually after using this tool.",
    "",
    "Usage guidelines:",
    "- Use when the user asks to draw a picture, generate an image, create a graphic, or visualize something.",
    "- For best quality, use descriptive English prompts containing: [Subject] + [Scene/background] + [Style/Art type] + [Lighting] + [Composition] + [Quality details].",
    "- If you have reference images, pass their URLs in the `images` array."
  ].join("\n");
}

function resolveEngine(settings: RuntimeSettings["imageGenerate"], requested?: string): ImageGenerateEngine {
  if (requested && requested !== "auto") {
    const engineId = requested as ImageGenerateEngine;
    const config = settings.engines[engineId];
    if (config?.enabled && config.apiKey.trim()) {
      return engineId;
    }
    throw new Error(`Requested image generation engine '${engineId}' is not enabled or lacks an API key.`);
  }

  const defaultEngine = settings.defaultEngine;
  const priorityList: ImageGenerateEngine[] = defaultEngine && defaultEngine !== "auto"
    ? [defaultEngine, "agnes", "openai", "openai-chat", "google", "volcengine", "modelscope"]
    : ["agnes", "openai", "openai-chat", "google", "volcengine", "modelscope"];
  const seen = new Set<ImageGenerateEngine>();
  for (const engineId of priorityList) {
    if (seen.has(engineId)) continue;
    seen.add(engineId);
    const config = settings.engines[engineId];
    if (config?.enabled && config.apiKey.trim()) {
      return engineId;
    }
  }

  throw new Error(
    "No image generation engine is enabled. Please configure at least one API key: " +
    "AGNES_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, VOLCENGINE_API_KEY, or MODELSCOPE_API_KEY."
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

function sanitizeRequestHeaders(headers: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Array.isArray(headers)
      ? headers
      : Object.entries(headers);

  for (const [key, value] of entries) {
    const headerName = String(key);
    const headerValue = String(value);
    if (/authorization|api[-_]?key|x-api-key/i.test(headerName)) {
      const prefix = headerValue.slice(0, Math.min(12, headerValue.length));
      result[headerName] = `${prefix}...redacted`;
    } else {
      result[headerName] = headerValue;
    }
  }
  return result;
}

function redactText(value: string, secrets: string[]): string {
  let text = value.replace(/([?&]key=)[^&#\s"]+/gi, "$1...redacted");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("...redacted");
  }
  return text.replace(
    /("(?:bytesBase64Encoded|b64_json)"\s*:\s*")([^"]{80,})(")/g,
    (_match, prefix: string, b64: string, suffix: string) => `${prefix}[base64 ${b64.length} chars redacted]${suffix}`
  );
}

export function createImageGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  sessionId?: string;
  taskStore?: SqliteImageTaskStore;
}): AgentTool<typeof imageGenerateSchema> {
  const settings = options.getSettings();
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
  const taskStore = options.taskStore || new SqliteImageTaskStore();
  const sessionId = options.sessionId || "default";

  return {
    name: "imageGenerate",
    label: "imageGenerate",
    description: buildImageGenerateDescription(settings),
    parameters: imageGenerateSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal): Promise<any> => {
      const currentSettings = options.getSettings();
      if (!currentSettings.imageGenerate.enabled) {
        throw new Error("Image generation tool is disabled in settings.");
      }

      const configuredSecrets = Object.values(currentSettings.imageGenerate.engines)
        .map((engineSettings) => engineSettings.apiKey?.trim())
        .filter((value): value is string => Boolean(value));

      const loggingFetch = async (url: string | URL | Request, init?: RequestInit) => {
        const urlText = typeof url === "string" || url instanceof URL ? String(url) : url.url;
        console.log(`[Agent Image Tool] [HTTP REQUEST] URL: ${redactText(urlText, configuredSecrets)}`);
        if (init?.headers) {
          console.log(`[Agent Image Tool] [HTTP REQUEST HEADERS]:`, JSON.stringify(sanitizeRequestHeaders(init.headers)));
        }
        if (init?.body) {
          console.log(`[Agent Image Tool] [HTTP REQUEST BODY]: ${redactText(String(init.body), configuredSecrets).slice(0, 2000)}`);
        }
        try {
          const response = await globalThis.fetch(url, init);
          let text = "";
          try {
            text = await response.clone().text();
          } catch (bodyError) {
            text = `[failed to read response body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}]`;
          }
          console.log(`[Agent Image Tool] [HTTP RESPONSE] Status: ${response.status} ${response.statusText || ""}`.trim());
          console.log(`[Agent Image Tool] [HTTP RESPONSE BODY]: ${redactText(text, configuredSecrets).slice(0, 2000) || "(empty)"}`);
          return response;
        } catch (err) {
          console.error(`[Agent Image Tool] [HTTP FETCH ERROR]:`, err);
          throw err;
        }
      };

      const inputPrompt = String(params.prompt || "").trim();
      if (!inputPrompt) {
        throw new Error("Prompt is required.");
      }

      // 1. Resolve engine
      const engine = resolveEngine(currentSettings.imageGenerate, params.engine);
      const engineEnabled = currentSettings.imageGenerate.engines[engine]?.enabled === true;

      // 2. Resolve output path
      const outName = String(params.outputName || "").trim() || `image_${Date.now()}.png`;
      const target = routeDefaultArtifactPath(outName, options.artifactDir);
      const filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);

      const requestParams = {
        model: params.model || currentSettings.imageGenerate.engines[engine]?.model,
        engineEnabled,
        providerEnabled: engineEnabled,
        size: params.size,
        seed: params.seed,
        images: params.images,
        outputName: outName
      };

      const taskId = crypto.randomUUID();
      taskStore.createTask(taskId, engine, sessionId, inputPrompt, requestParams);

      try {
        // 3. Execute provider
        const provider = IMAGE_GENERATE_PROVIDERS[engine];
        if (!provider) {
          throw new Error(`Provider not implemented for engine '${engine}'`);
        }

        const providerInput: ImageGenerateInput = {
          prompt: inputPrompt,
          engine,
          model: params.model || currentSettings.imageGenerate.engines[engine]?.model,
          size: params.size,
          seed: params.seed,
          images: params.images,
          outputName: outName
        };

        const providerContext = {
          settings: currentSettings.imageGenerate,
          fetch: loggingFetch,
          signal
        };

        const result = await provider.generate(providerInput, providerContext);

        // 4. Resolve Image Buffer
        let imageBuffer: Buffer;
        if (result.imageBuffer) {
          imageBuffer = result.imageBuffer;
        } else if (result.imageBase64) {
          imageBuffer = Buffer.from(result.imageBase64, "base64");
        } else if (result.imageUrl) {
          const downloadResponse = await globalThis.fetch(result.imageUrl, { signal });
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download generated image from url: ${downloadResponse.statusText}`);
          }
          const ab = await downloadResponse.arrayBuffer();
          imageBuffer = Buffer.from(ab);
        } else {
          throw new Error("Provider returned no image source (URL, Base64, or Buffer).");
        }

        // 5. Write to File
        const dir = dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, imageBuffer);

        // 6. Automatically upload / attach if capability is available
        let uploadedMessage = "";
        let uploadError: string | undefined;
        if (options.uploadFile) {
          const title = basename(filePath);
          const text = `Generated image: ${inputPrompt}`;
          try {
            await options.uploadFile(filePath, title, text);
            uploadedMessage = " (Automatically uploaded and sent to chat channel)";
          } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
            uploadedMessage = " (Generated successfully, but automatic chat upload failed)";
          }
        }

        // Record completed task state to SQLite
        taskStore.updateTaskProgress(taskId, "completed", filePath, undefined, result.imageUrl);

        return {
          content: [{
            type: "text",
            text: [
              `Successfully generated image using '${engine}' engine.${uploadedMessage}`,
              result.imageUrl ? `Remote URL: ${result.imageUrl}` : undefined,
              `Saved file to: ${target.path}`,
              `Absolute path: ${filePath}`,
              uploadError ? `Upload error: ${uploadError}` : undefined
            ].filter(Boolean).join("\n")
          }],
          details: {
            taskId,
            engine,
            engineEnabled,
            providerEnabled: engineEnabled,
            model: providerInput.model || "default",
            prompt: inputPrompt,
            imageUrl: result.imageUrl,
            path: target.path,
            filePath,
            uploaded: !!options.uploadFile && !uploadError,
            uploadError
          }
        };
      } catch (err: any) {
        const errMsg = err.message || String(err);
        taskStore.updateTaskProgress(taskId, "failed", undefined, errMsg);
        throw err;
      }
    }
  };
}

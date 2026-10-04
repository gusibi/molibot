import { selectImageEngine } from "$lib/shared/imageGenerate.js";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { promises as fs } from "node:fs";
import { dirname, basename, parse, join } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import crypto from "node:crypto";
import { getImageGenerateProvider } from "./providers.js";
import type { ImageGenerateEngine, ImageGenerateInput, ImageGenerateProviderResult } from "./types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { SqliteImageTaskStore } from "./imageTaskStore.js";
import { describeFileToolResult, type RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";

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
    Type.String({
      pattern: "^[a-z][a-z0-9_-]{0,63}$",
      description: "Engine id (built-in or custom)."
    })
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
  const engineList = Object.keys(settings.imageGenerate.engines)
    .filter((id) => settings.imageGenerate.engines[id as ImageGenerateEngine]?.enabled)
    .join(", ") || "none configured";
  return [
    "- Generates high-quality images using configured image generation engines (built-in and custom).",
    "- Auto-saves the generated image locally to your dated scratch directory or a custom path.",
    "- Automatically uploads and displays the image to the chat interface so the user sees it immediately. Do not call `attach` manually after using this tool.",
    "",
    `Enabled engines: ${engineList}.`,
    ...(settings.imageGenerate.engines.pi?.enabled ? ["Pi uses the configured image model and existing Provider credentials. Omit size and seed; model overrides must use pi|provider|model keys."] : []),
    "",
    "Usage guidelines:",
    "- Use when the user asks to draw a picture, generate an image, create a graphic, or visualize something.",
    "- For best quality, use descriptive English prompts containing: [Subject] + [Scene/background] + [Style/Art type] + [Lighting] + [Composition] + [Quality details].",
    "- If you have reference images, pass their URLs in the `images` array."
  ].join("\n");
}


function detectedImageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return undefined;
}

function resolveEngine(settings: RuntimeSettings["imageGenerate"], requested?: string): ImageGenerateEngine {
  const selected = selectImageEngine(requested, settings.defaultEngine, Object.entries(settings.engines).map(([id, engine]) => ({ id, enabled: engine.enabled, credentialSource: engine.credentialSource, hasCredentials: Boolean(engine.apiKey?.trim()) })));
  if (selected) return selected;
  throw new Error(requested && requested !== "auto"
    ? `Requested image generation engine '${requested}' is not enabled or lacks an API key.`
    : "No image generation engine is enabled. Please configure at least one API key.");
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
  let text = value.replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g, "[image data redacted]")
    .replace(/([?&]key=)[^&#\s"]+/gi, "$1...redacted");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("...redacted");
  }
  return text.replace(
    /("(?:bytesBase64Encoded|b64_json)"\s*:\s*")([^"]{80,})(")/g,
    (_match, prefix: string, b64: string, suffix: string) => `${prefix}[base64 ${b64.length} chars redacted]${suffix}`
  );
}

function normalizeImageUrls(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const urls = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((s): s is string => Boolean(s));
    return urls.length ? urls : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const fromParsed = normalizeImageUrls(parsed);
        if (fromParsed?.length) return fromParsed;
      } catch {
        // fall through to plain-string handling
      }
    }
    const urls = trimmed.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return urls.length ? urls : undefined;
  }
  return undefined;
}

export function createImageGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  outputLayout?: RunOutputLayout;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  sessionId?: string;
  usageScope?: { channel: string; botId: string; agentId?: string; roomId?: string };
  taskStore?: SqliteImageTaskStore;
  piModels?: Models;
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
        console.log(`[Agent Image Tool] [HTTP REQUEST] URL: ${providerCredentials ? "[Pi image operation]" : redactText(urlText, configuredSecrets)}`);
        if (!providerCredentials && init?.headers) {
          console.log(`[Agent Image Tool] [HTTP REQUEST HEADERS]:`, JSON.stringify(sanitizeRequestHeaders(init.headers)));
        }
        if (!providerCredentials && init?.body) {
          console.log(`[Agent Image Tool] [HTTP REQUEST BODY]: ${redactText(String(init.body), configuredSecrets).slice(0, 2000)}`);
        }
        try {
          const response = await globalThis.fetch(url, init);
          let text = "";
          try {
            text = providerCredentials || response.headers.get("content-type")?.startsWith("image/")
              ? "[image response body omitted]" : await response.clone().text();
          } catch (bodyError) {
            text = `[failed to read response body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}]`;
          }
          console.log(`[Agent Image Tool] [HTTP RESPONSE] Status: ${response.status} ${response.statusText || ""}`.trim());
          console.log(`[Agent Image Tool] [HTTP RESPONSE BODY]: ${redactText(text, configuredSecrets).slice(0, 2000) || "(empty)"}`);
          return response;
        } catch (err) {
          console.error(`[Agent Image Tool] [HTTP FETCH ERROR]:`, providerCredentials ? "Pi image HTTP request failed" : err);
          throw err;
        }
      };

      // Validate before any side effect: a non-string prompt used to stringify to
      // "[object Object]", generate an unrelated image, and auto-upload it to the
      // user's chat. This tool creates images from text; it never reads one.
      if (typeof params.prompt !== "string") {
        throw new Error(
          `imageGenerate 'prompt' must be a string describing the image to create, received ${
            Array.isArray(params.prompt) ? "array" : params.prompt === null ? "null" : typeof params.prompt
          }. This tool generates a new image from text and cannot read or describe an existing image.`
        );
      }
      const inputPrompt = params.prompt.trim();
      if (!inputPrompt) {
        throw new Error("Prompt is required.");
      }

      // 1. Resolve engine
      const engine = resolveEngine(currentSettings.imageGenerate, params.engine);
      const engineEnabled = currentSettings.imageGenerate.engines[engine]?.enabled === true;
      const providerCredentials = currentSettings.imageGenerate.engines[engine]?.credentialSource === "provider";

      // 2. Resolve output path
      let outName = String(params.outputName || "").trim() || `image_${Date.now()}.png`;
      const target = routeDefaultArtifactPath(outName, options.artifactDir);
      let filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);

      const requestParams = {
        model: params.model || currentSettings.imageGenerate.engines[engine]?.model,
        usageScope: options.usageScope,
        engineEnabled,
        providerEnabled: engineEnabled,
        size: params.size,
        seed: params.seed,
        images: normalizeImageUrls(params.images),
        outputName: outName
      };

      const taskId = crypto.randomUUID();
      taskStore.createTask(taskId, engine, sessionId, inputPrompt, requestParams);
      let generated = false;

      try {
        // 3. Execute provider
        const engineProtocol = currentSettings.imageGenerate.engines[engine]?.protocol;
        const provider = getImageGenerateProvider(engine, engineProtocol, options.piModels);
        if (!provider) {
          throw new Error(`Provider not implemented for engine '${engine}'`);
        }

        const providerInput: ImageGenerateInput = {
          prompt: inputPrompt,
          engine,
          model: params.model || currentSettings.imageGenerate.engines[engine]?.model,
          size: params.size,
          seed: params.seed,
          images: requestParams.images,
          outputName: outName
        };

        const providerContext = {
          settings: currentSettings.imageGenerate,
          fetch: loggingFetch,
          signal,
          onProviderResult: (result: Pick<ImageGenerateProviderResult, "text" | "usage">) => taskStore.recordResult(taskId, result.text, result.usage)
        };

        const result = await provider.generate(providerInput, providerContext);
        generated = true;
        taskStore.recordResult(taskId, result.text, result.usage);

        // 4. Resolve Image Buffer
        let imageBuffer: Buffer;
        let mimeType = result.mimeType;
        if (result.images?.length) {
          imageBuffer = result.images[0].imageBuffer;
        } else if (result.imageBuffer) {
          imageBuffer = result.imageBuffer;
        } else if (result.imageBase64) {
          imageBuffer = Buffer.from(result.imageBase64, "base64");
        } else if (result.imageUrl) {
          const downloadResponse = await globalThis.fetch(result.imageUrl, { signal });
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download generated image from url: ${downloadResponse.statusText}`);
          }
          const responseMime = downloadResponse.headers.get("content-type")?.split(";")[0].trim();
          if (responseMime?.startsWith("image/")) mimeType ??= responseMime;
          const ab = await downloadResponse.arrayBuffer();
          imageBuffer = Buffer.from(ab);
        } else {
          throw new Error("Provider returned no image source (URL, Base64, or Buffer).");
        }

        const mimeExtensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" };
        const images = result.images ?? [{ imageBuffer, mimeType: detectedImageMime(imageBuffer) ?? mimeType ?? "" }];
        if (images.some(image => !mimeExtensions[image.mimeType])) throw new Error("Unsupported generated image MIME type.");
        if (result.images || images[0]!.mimeType !== "image/png") {
          filePath = join(dirname(filePath), `${parse(filePath).name}${mimeExtensions[images[0]!.mimeType]}`);
          ensureAllowedPath(filePath);
          outName = basename(filePath);
        }
        // 5. Save and register every output before attempting channel delivery.
        const dir = dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        const artifacts = [];
        for (const [index, image] of images.entries()) {
          signal?.throwIfAborted();
          const path = index === 0 ? filePath : join(dir, `${parse(filePath).name}-${index + 1}${mimeExtensions[image.mimeType]}`);
          ensureAllowedPath(path);
          await fs.writeFile(path, image.imageBuffer, { signal });
          const artifact = { index, path, mimeType: image.mimeType, byteLength: image.imageBuffer.byteLength };
          taskStore.recordArtifact(taskId, artifact);
          artifacts.push(artifact);
        }
        signal?.throwIfAborted();

        // 6. Automatically upload / attach if capability is available
        let uploadedMessage = "";
        let uploadError: string | undefined;
        let uploadedCount = 0;
        if (options.uploadFile) {
          const text = `Generated image: ${inputPrompt}`;
          try {
            for (const artifact of artifacts) {
              signal?.throwIfAborted();
              await options.uploadFile(artifact.path, basename(artifact.path), text);
              uploadedCount++;
            }
            uploadedMessage = " (Automatically uploaded and sent to chat channel)";
          } catch (err) {
            uploadError = err instanceof Error ? err.message : String(err);
            uploadedMessage = ` (Generated successfully; uploaded ${uploadedCount}/${artifacts.length} images before automatic chat upload failed)`;
          }
        }
        signal?.throwIfAborted();

        // Record completed task state to SQLite
        taskStore.updateTaskProgress(taskId, "completed", filePath, undefined, result.imageUrl);

        return {
          content: [{
            type: "text",
            text: [
              `Successfully generated image using '${engine}' engine.${uploadedMessage}`,
              result.text || undefined,
              artifacts.length > 1 ? `Saved ${artifacts.length} images:\n${artifacts.map(artifact => artifact.path).join("\n")}` : undefined,
              result.imageUrl ? `Remote URL: ${result.imageUrl}` : undefined,
              `Saved file to: ${target.path}`,
              `Absolute path: ${filePath}`,
              uploadError ? `Upload error: ${uploadError}` : undefined
            ].filter(Boolean).join("\n")
          }],
          details: {
            ...(options.outputLayout
              ? describeFileToolResult(options.outputLayout, filePath, "generated", outName, imageBuffer.byteLength)
              : {}),
            taskId,
            artifacts,
            textOutput: result.text,
            usage: result.usage,
            engine,
            engineEnabled,
            providerEnabled: engineEnabled,
            model: providerInput.model || "default",
            prompt: inputPrompt,
            imageUrl: result.imageUrl,
            path: target.path,
            filePath,
            uploaded: !!options.uploadFile && !uploadError,
            uploadedCount,
            uploadError
          },
          usage: result.usage
        };
      } catch (err: any) {
        const errMsg = `${generated && !signal?.aborted ? "Images generated, but local artifact processing failed: " : ""}${err.message || String(err)}`;
        taskStore.updateTaskProgress(taskId, signal?.aborted || err?.name === "AbortError" ? "cancelled" : "failed", undefined, errMsg);
        if (generated && !signal?.aborted && err?.name !== "AbortError") throw new Error(errMsg, { cause: err });
        throw err;
      }
    }
  };
}

import type { ImageTaskRecord } from "$lib/server/agent/imageGenerate/imageTaskStore.js";
import type { VideoTaskRecord } from "$lib/server/agent/videoGenerate/videoTaskStore.js";
import type { DesktopMediaTask } from "$lib/shared/desktop";

// Provider request params can carry secrets (apiKey) and large/private blobs
// (reference image data). The WebView must never receive those (pitfall §5), so
// we project only an allow-list of primitive display fields.
const SAFE_PARAM_KEYS = [
  "model", "size", "seed", "quality", "style", "n", "steps",
  "guidanceScale", "aspectRatio", "ratio", "resolution", "duration", "fps", "outputName"
] as const;

function sanitizeMediaRequestParams(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") return undefined;
  const source = params as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_PARAM_KEYS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function buildDesktopImageTask(task: ImageTaskRecord): DesktopMediaTask {
  return {
    id: task.id,
    kind: "image",
    engine: task.engine,
    status: task.status,
    prompt: task.prompt,
    resultUrl: task.imageUrl,
    requestParams: sanitizeMediaRequestParams(task.requestParams),
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function buildDesktopVideoTask(task: VideoTaskRecord): DesktopMediaTask {
  return {
    id: task.id,
    kind: "video",
    engine: task.engine,
    status: task.status,
    progress: task.progress,
    prompt: task.prompt,
    resultUrl: task.videoUrl,
    requestParams: sanitizeMediaRequestParams(task.requestParams),
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

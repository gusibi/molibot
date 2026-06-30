import type { ImageTaskRecord } from "$lib/server/agent/imageGenerate/imageTaskStore.js";
import type { VideoTaskRecord } from "$lib/server/agent/videoGenerate/videoTaskStore.js";
import type { DesktopMediaTask } from "$lib/shared/desktop";

export function buildDesktopImageTask(task: ImageTaskRecord): DesktopMediaTask {
  return {
    id: task.id,
    kind: "image",
    engine: task.engine,
    status: task.status,
    prompt: task.prompt,
    resultUrl: task.imageUrl,
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
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { SqliteVideoTaskStore } from "$lib/server/agent/videoGenerate/videoTaskStore.js";
import { queryVideoTaskStatus } from "$lib/server/agent/videoGenerate/providers.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

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

const taskFailures = new Map<string, number>();

export const GET: RequestHandler = async () => {
  try {
    const taskStore = new SqliteVideoTaskStore();
    const tasks = taskStore.getRecentTasks(50);
    const runtime = getRuntime();
    const settings = runtime.getSettings();

    const cwd = storagePaths.dataDir;
    const workspaceDir = storagePaths.dataDir;
    const artifactDir = "settings-video-downloads";
    const ensureAllowedPath = createPathGuard(cwd, workspaceDir);

    for (const task of tasks) {
      if (task.status === "processing") {
        try {
          console.log(`[Video Task Poller] Checking status for task: ${task.id} (engine: ${task.engine})`);
          
          const providerContext = {
            settings: settings.videoGenerate,
            fetch: async (url: string, init?: RequestInit) => {
              console.log(`[Video Task Poller] [HTTP REQUEST] URL: ${url}`);
              if (init?.body) {
                console.log(`[Video Task Poller] [HTTP REQUEST BODY]: ${init.body}`);
              }
              const response = await globalThis.fetch(url, init);
              
              // Clone the response to read it for console logging
              const cloned = response.clone();
              const text = await cloned.text();
              console.log(`[Video Task Poller] [HTTP RESPONSE] Status: ${response.status}, Body: ${text.slice(0, 500)}`);
              
              return response;
            }
          };

          const videoId = task.pollParams?.videoId;
          const res = await queryVideoTaskStatus(task.id, task.engine as any, providerContext, videoId);
          console.log(`[Video Task Poller] Unified status result for ${task.id}:`, res);

          if (res.status === "completed" && res.videoUrl) {
            console.log(`[Video Task Poller] Task ${task.id} completed. Downloading video...`);
            const downloadResponse = await globalThis.fetch(res.videoUrl);
            if (!downloadResponse.ok) {
              throw new Error(`Failed to download completed video: ${downloadResponse.statusText}`);
            }
            const ab = await downloadResponse.arrayBuffer();
            const videoBuffer = Buffer.from(ab);

            const outName = task.pollParams?.outputName || task.prompt.slice(0, 15).replace(/[^a-zA-Z0-9]/g, "_") + `_${Date.now()}.mp4`;
            const target = routeDefaultArtifactPath(outName, artifactDir);
            const filePath = resolveToolPath(cwd, target.path);
            ensureAllowedPath(filePath);

            const dir = dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, videoBuffer);
            console.log(`[Video Task Poller] Video downloaded and saved to: ${filePath}`);

            taskStore.updateTaskProgress(task.id, "completed", 100, filePath);
            task.status = "completed";
            task.progress = 100;
            task.videoPath = filePath;
            taskFailures.delete(task.id);
          } else if (res.status === "failed") {
            const err = res.error || "Unknown provider generation failure";
            console.error(`[Video Task Poller] Task ${task.id} failed: ${err}`);
            taskStore.updateTaskProgress(task.id, "failed", 0, undefined, err);
            task.status = "failed";
            task.progress = 0;
            task.errorMessage = err;
            taskFailures.delete(task.id);
          } else {
            const progress = res.progress ?? task.progress;
            console.log(`[Video Task Poller] Task ${task.id} is still processing. Progress: ${progress}%`);
            taskStore.updateTaskProgress(task.id, "processing", progress);
            task.progress = progress;
            taskFailures.delete(task.id);
          }
        } catch (e) {
          console.error(`[Video Task Poller] Error checking status for task ${task.id}:`, e);
          const errMsg = e instanceof Error ? e.message : String(e);
          const is4xx = /HTTP (4\d\d)/i.test(errMsg);
          const currentCount = (taskFailures.get(task.id) || 0) + 1;
          taskFailures.set(task.id, currentCount);

          if (is4xx || currentCount >= 3) {
            console.error(`[Video Task Poller] Marking task ${task.id} as failed due to persistent/client error: ${errMsg}`);
            taskStore.updateTaskProgress(task.id, "failed", 0, undefined, `Query failed: ${errMsg}`);
            task.status = "failed";
            task.progress = 0;
            task.errorMessage = `Query failed: ${errMsg}`;
            taskFailures.delete(task.id);
          }
        }
      }
    }

    return json({ ok: true, tasks });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) {
    return json({ ok: false, error: "Missing taskId parameter" }, { status: 400 });
  }

  try {
    const taskStore = new SqliteVideoTaskStore();
    taskStore.deleteTask(taskId);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

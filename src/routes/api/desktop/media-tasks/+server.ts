import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { SqliteImageTaskStore } from "$lib/server/agent/imageGenerate/imageTaskStore.js";
import { SqliteVideoTaskStore } from "$lib/server/agent/videoGenerate/videoTaskStore.js";
import { buildDesktopImageTask, buildDesktopVideoTask } from "$lib/server/app/desktopMediaTasks";
import type { DesktopMediaTaskKind } from "$lib/shared/desktop";

function parseKind(value: string | null): DesktopMediaTaskKind | null {
  return value === "image" || value === "video" ? value : null;
}

export const GET: RequestHandler = async ({ url }) => {
  const kind = parseKind(url.searchParams.get("kind"));
  if (!kind) return json({ ok: false, error: "kind must be image or video" }, { status: 400 });
  try {
    const tasks = kind === "image"
      ? new SqliteImageTaskStore().getRecentTasks(50).map(buildDesktopImageTask)
      : new SqliteVideoTaskStore().getRecentTasks(50).map(buildDesktopVideoTask);
    return json({ ok: true, tasks });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const kind = parseKind(url.searchParams.get("kind"));
  const taskId = url.searchParams.get("taskId")?.trim();
  if (!kind || !taskId) return json({ ok: false, error: "kind and taskId are required" }, { status: 400 });
  try {
    if (kind === "image") new SqliteImageTaskStore().deleteTask(taskId);
    else new SqliteVideoTaskStore().deleteTask(taskId);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { SqliteImageTaskStore } from "$lib/server/agent/imageGenerate/imageTaskStore.js";

export const GET: RequestHandler = async () => {
  try {
    const taskStore = new SqliteImageTaskStore();
    const tasks = taskStore.getRecentTasks(50);
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
    const taskStore = new SqliteImageTaskStore();
    taskStore.deleteTask(taskId);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

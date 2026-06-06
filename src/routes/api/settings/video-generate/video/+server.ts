import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { SqliteVideoTaskStore } from "$lib/server/agent/videoGenerate/videoTaskStore.js";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export const GET: RequestHandler = async ({ url }) => {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) {
    return json({ ok: false, error: "Missing taskId" }, { status: 400 });
  }

  try {
    const taskStore = new SqliteVideoTaskStore();
    const task = taskStore.getTask(taskId);
    if (!task) {
      return json({ ok: false, error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "completed") {
      return json({ ok: false, error: "Video not ready or generation failed" }, { status: 400 });
    }

    if ((!task.videoPath || !existsSync(task.videoPath)) && task.videoUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": task.videoUrl
        }
      });
    }

    if (!task.videoPath || !existsSync(task.videoPath)) {
      return json({ ok: false, error: "Video file not found on disk" }, { status: 404 });
    }

    const videoBuffer = readFileSync(task.videoPath);
    return new Response(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `inline; filename="${basename(task.videoPath)}"`
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

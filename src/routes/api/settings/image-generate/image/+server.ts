import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { SqliteImageTaskStore } from "$lib/server/agent/imageGenerate/imageTaskStore.js";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export const GET: RequestHandler = async ({ url }) => {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) {
    return json({ ok: false, error: "Missing taskId" }, { status: 400 });
  }

  try {
    const taskStore = new SqliteImageTaskStore();
    const task = taskStore.getTask(taskId);
    if (!task) {
      return json({ ok: false, error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "completed") {
      return json({ ok: false, error: "Image not ready or generation failed" }, { status: 400 });
    }

    if ((!task.imagePath || !existsSync(task.imagePath)) && task.imageUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": task.imageUrl
        }
      });
    }

    if (!task.imagePath || !existsSync(task.imagePath)) {
      return json({ ok: false, error: "Image file not found on disk" }, { status: 404 });
    }

    const imageBuffer = readFileSync(task.imagePath);
    let contentType = "image/png";
    const ext = task.imagePath.toLowerCase().split('.').pop();
    if (ext === "jpg" || ext === "jpeg") {
      contentType = "image/jpeg";
    } else if (ext === "webp") {
      contentType = "image/webp";
    } else if (ext === "gif") {
      contentType = "image/gif";
    }

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${basename(task.imagePath)}"`
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

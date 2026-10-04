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

  const taskStore = new SqliteImageTaskStore();
  try {
    const task = taskStore.getTask(taskId);
    if (!task) {
      return json({ ok: false, error: "Task not found" }, { status: 404 });
    }

    const rawIndex = url.searchParams.get("index");
    const index = rawIndex === null ? 0 : Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) return json({ ok: false, error: "Invalid image index" }, { status: 400 });
    const artifact = task.artifacts?.find(item => item.index === index);
    if (index > 0 && !artifact) return json({ ok: false, error: "Image output not found" }, { status: 404 });
    const imagePath = artifact?.path ?? task.imagePath;

    if (task.status !== "completed" && !artifact) {
      return json({ ok: false, error: "Image not ready or generation failed" }, { status: 400 });
    }

    if ((!imagePath || !existsSync(imagePath)) && task.imageUrl && index === 0) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": task.imageUrl
        }
      });
    }

    if (!imagePath || !existsSync(imagePath)) {
      return json({ ok: false, error: "Image file not found on disk" }, { status: 404 });
    }

    const imageBuffer = readFileSync(imagePath);
    let contentType = artifact?.mimeType ?? "image/png";
    const ext = imagePath.toLowerCase().split('.').pop();
    if (!artifact) {
      if (ext === "jpg" || ext === "jpeg") {
        contentType = "image/jpeg";
      } else if (ext === "webp") {
        contentType = "image/webp";
      } else if (ext === "gif") {
        contentType = "image/gif";
      }
    }

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${basename(imagePath)}"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    taskStore.close();
  }
};

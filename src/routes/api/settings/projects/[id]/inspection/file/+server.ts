import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readProjectFile, getProjectFilePath } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { mimeFromFilename } from "$lib/shared/filePreview.js";
import { promises as fs } from "node:fs";

export const GET: RequestHandler = async ({ params, url }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const filePath = url.searchParams.get("path") ?? "";
  if (!filePath) return json({ ok: false, error: "File path is required" }, { status: 400 });

  const raw = url.searchParams.get("raw") === "true";
  if (raw) {
    try {
      const absolutePath = await getProjectFilePath(project, filePath);
      const fileBuffer = await fs.readFile(absolutePath);
      const mimeType = mimeFromFilename(filePath) ?? "application/octet-stream";
      return new Response(fileBuffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": fileBuffer.length.toString(),
          "Cache-Control": "public, max-age=3600"
        }
      });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  try {
    return json({ ok: true, preview: await readProjectFile(project, { path: filePath }) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

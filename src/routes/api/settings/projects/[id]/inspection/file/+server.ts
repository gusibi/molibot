import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readProjectFile, getProjectFilePath } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { mimeFromFilename } from "$lib/shared/filePreview.js";
import { streamFileWithRange } from "$lib/server/http/rangeResponse.js";
import { promises as fs } from "node:fs";

function parseOffset(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export const GET: RequestHandler = async ({ params, url, request }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const filePath = url.searchParams.get("path") ?? "";
  if (!filePath) return json({ ok: false, error: "File path is required" }, { status: 400 });

  const raw = url.searchParams.get("raw") === "true";
  if (raw) {
    try {
      const absolutePath = await getProjectFilePath(project, filePath);
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) return json({ ok: false, error: "Raw path is not a file" }, { status: 400 });

      // Project files change under the user's feet, so revalidate rather than
      // serving an hour-old image after the agent rewrote it.
      return streamFileWithRange({
        path: absolutePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mimeType: mimeFromFilename(filePath) ?? "application/octet-stream",
        rangeHeader: request.headers.get("range"),
        ifNoneMatch: request.headers.get("if-none-match")
      });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  try {
    const preview = await readProjectFile(project, {
      path: filePath,
      offset: parseOffset(url.searchParams.get("offset")),
      maxBytes: parseOffset(url.searchParams.get("maxBytes"))
    });
    return json({ ok: true, preview });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

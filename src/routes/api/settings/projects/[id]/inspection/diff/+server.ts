import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getProjectGitDiff } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = async ({ params, url }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const filePath = url.searchParams.get("path") ?? "";
  if (!filePath) return json({ ok: false, error: "File path is required" }, { status: 400 });
  try {
    return json({ ok: true, result: await getProjectGitDiff(project, { path: filePath }) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

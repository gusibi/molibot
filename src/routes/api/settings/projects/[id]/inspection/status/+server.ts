import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getProjectGitStatus } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = async ({ params }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  return json({ ok: true, result: await getProjectGitStatus(project) });
};

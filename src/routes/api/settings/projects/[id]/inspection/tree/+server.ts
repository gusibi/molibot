import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listProjectTree } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = async ({ params, url }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  try {
    const limitValue = Number(url.searchParams.get("limit"));
    const page = await listProjectTree(project, {
      path: url.searchParams.get("path") ?? "",
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : undefined
    });
    return json({ ok: true, page });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

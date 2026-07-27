import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { searchProject } from "$lib/server/projects/search.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = async ({ params, url }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  try {
    const limitValue = Number(url.searchParams.get("limit"));
    const result = await searchProject(project, {
      query: url.searchParams.get("q") ?? "",
      mode: url.searchParams.get("mode") === "content" ? "content" : "name",
      caseSensitive: url.searchParams.get("caseSensitive") === "true",
      limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : undefined
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

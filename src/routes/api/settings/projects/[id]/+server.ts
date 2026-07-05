import fs from "node:fs";
import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { getRuntime } from "$lib/server/app/runtime.js";

export const GET: RequestHandler = ({ params }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const sessionCount = getRuntime().sessions.listProjectConversations(project.id).length;
  return json({ ok: true, project, sessionCount });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json() as { name?: string; rootPath?: string; instructions?: string };
    const project = getProjectStore().update(params.id, body);
    if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
    return json({ ok: true, project });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = ({ params, url }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  if (url.searchParams.get("removeSessions") === "true") {
    const projectsRoot = path.resolve(storagePaths.projectsDir);
    const target = path.resolve(projectsRoot, project.id);
    const relative = path.relative(projectsRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return json({ ok: false, error: "Unsafe project session path" }, { status: 400 });
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  getProjectStore().remove(project.id);
  return json({ ok: true });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = () => json({ ok: true, projects: getProjectStore().list() });

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as { name?: string; rootPath?: string; instructions?: string };
    const project = getProjectStore().create({
      name: String(body.name ?? ""),
      rootPath: String(body.rootPath ?? ""),
      instructions: body.instructions
    });
    return json({ ok: true, project }, { status: 201 });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

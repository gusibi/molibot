import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { confirmStorageMigration, previewStorageMigration, storageMigrationStatus } from "$lib/server/sessions/agentStorageLifecycle.js";
import { getRuntime } from "$lib/server/app/runtime.js";
export const GET: RequestHandler = () => {
  try { return json({ ok: true, ...storageMigrationStatus() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return json({ ok: false, needed: true, error: String(error) }, { status: 500 }); }
};
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  if (!["confirm", "preview"].includes(body.action)) return json({ ok: false, error: "Explicit confirmation is required" }, { status: 400 });
  try {
    if (body.ignoredPaths !== undefined && (!Array.isArray(body.ignoredPaths) || body.ignoredPaths.some((item: unknown) => typeof item !== "string"))) return json({ ok: false, error: "ignoredPaths must be a list of resource paths" }, { status: 400 });
    if (body.botAssignments !== undefined && (!Array.isArray(body.botAssignments) || body.botAssignments.some((item: any) => !item || typeof item.channel !== "string" || typeof item.botId !== "string" || (item.agentId !== null && typeof item.agentId !== "string")))) return json({ ok: false, error: "botAssignments must list channel, botId and agentId" }, { status: 400 });
    if (body.action === "preview") return json({ ok: true, ...previewStorageMigration(body.ignoredPaths ?? [], body.botAssignments), running: false });
    await confirmStorageMigration(body.ignoredPaths, body.botAssignments);
    getRuntime();
    return json({ ok: true, ...storageMigrationStatus() });
  } catch (error) { return json({ ok: false, needed: true, error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
};

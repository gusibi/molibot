import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { projectBulkResult } from "$lib/server/sessions/sessionManagedApi.js";

/** T7 durable bulk progress: readable after reconnect from the owning store. */
export const GET: RequestHandler = async ({ params }) => {
  const operationId = String(params.operationId ?? "").trim();
  if (!operationId) return json({ ok: false, error: "operationId is required" }, { status: 400 });
  const result = getRuntime().sessionBulk.getOperation(operationId);
  if (!result) return json({ ok: false, error: `Unknown bulk operation: ${operationId}` }, { status: 404 });
  return json({ ok: true, ...projectBulkResult(result) });
};

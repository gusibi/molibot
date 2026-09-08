import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";
import { projectBulkResult } from "$lib/server/sessions/sessionManagedApi.js";

/** T7 bulk retry: retries only failed items of an operation. */
export const POST: RequestHandler = async ({ request }) => {
  let body: { operationId?: unknown; userId?: unknown; profileId?: unknown };
  try {
    body = (await request.json()) as { operationId?: unknown; userId?: unknown; profileId?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const operationId = String(body.operationId ?? "").trim();
  if (!operationId) return json({ ok: false, error: "operationId is required" }, { status: 400 });
  const requester =
    body.userId !== undefined || body.profileId !== undefined
      ? toWebExternalUserId(
          sanitizeWebUserId(typeof body.userId === "string" ? body.userId : null),
          sanitizeWebProfileId(typeof body.profileId === "string" ? body.profileId : null)
        )
      : undefined;
  try {
    const { sessionBulk } = getRuntime();
    return json({ ok: true, ...projectBulkResult(sessionBulk.retryFailed({ operationId, requesterExternalUserId: requester })) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

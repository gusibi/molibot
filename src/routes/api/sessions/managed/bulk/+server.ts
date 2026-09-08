import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";
import { projectBulkResult, validateBulkExecute } from "$lib/server/sessions/sessionManagedApi.js";

/**
 * T7 bulk execute: archive / restore / delete over explicit targets or a
 * server-issued selectionId, guarded by an idempotency key. Returns the
 * operation identity, counts and per-item outcomes; failures retry via
 * `bulk/retry` while succeeded/skipped items stay untouched.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  let valid;
  try {
    valid = validateBulkExecute(body);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const requester =
    body.userId !== undefined || body.profileId !== undefined
      ? toWebExternalUserId(
          sanitizeWebUserId(typeof body.userId === "string" ? body.userId : null),
          sanitizeWebProfileId(typeof body.profileId === "string" ? body.profileId : null)
        )
      : undefined;
  try {
    const { sessionBulk } = getRuntime();
    const result = sessionBulk.execute({ ...valid, requesterExternalUserId: requester });
    return json({ ok: true, ...projectBulkResult(result) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";
import { validateSelectionCreate } from "$lib/server/sessions/sessionManagedApi.js";

/**
 * T7 all-matching selection snapshot: captures identities + versions now;
 * later arrivals are never silently added and execution rechecks everything.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  let targetIds: string[];
  try {
    ({ targetIds } = validateSelectionCreate(body));
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
    const snapshot = sessionBulk.createSelection({
      requesterExternalUserId: requester,
      targets: targetIds
    });
    return json({ ok: true, selectionId: snapshot.selectionId, count: snapshot.count });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

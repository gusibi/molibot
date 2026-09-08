import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";
import { parseManagedQuery, projectManagedItem } from "$lib/server/sessions/sessionManagedApi.js";

function requesterOf(url: URL): string | undefined {
  const hasUser = url.searchParams.has("userId");
  const hasProfile = url.searchParams.has("profileId");
  if (!hasUser && !hasProfile) return undefined;
  return toWebExternalUserId(
    sanitizeWebUserId(url.searchParams.get("userId")),
    sanitizeWebProfileId(url.searchParams.get("profileId"))
  );
}

/**
 * T7 managed list: server-side pagination + per-state counts, display
 * metadata only. Auth scoping follows the existing sessions API (userId +
 * profileId → requester); ownership is rechecked per row by the shared
 * service — a caller-supplied id never grants access by itself.
 */
export const GET: RequestHandler = async ({ url }) => {
  let parsed;
  try {
    parsed = parseManagedQuery(url.searchParams);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  try {
    const { sessionLifecycle } = getRuntime();
    const result = sessionLifecycle.queryManaged({ ...parsed, requesterExternalUserId: requesterOf(url) });
    return json({
      ok: true,
      items: result.items.map(projectManagedItem),
      total: result.total,
      counts: result.counts,
      limit: result.limit,
      offset: result.offset
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

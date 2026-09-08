import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

/**
 * T7 delete confirmation facts: exact count, recovery period and data scope.
 * Saved memories and independent artifacts survive; only Session-owned data
 * is removed and the search projection drops immediately.
 */
export const GET: RequestHandler = async ({ url }) => {
  const count = Math.floor(Number(url.searchParams.get("count") ?? "0"));
  if (!Number.isFinite(count) || count <= 0) {
    return json({ ok: false, error: "count must be a positive integer" }, { status: 400 });
  }
  return json({ ok: true, ...getRuntime().sessionBulk.describeDelete(count) });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200));
  const data = runtime.modelErrorTracker.getRecent(limit);
  return json({ ok: true, ...data });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getSkillManager } from "$lib/server/app/skillManager";
import type { DesktopSkillManagerDetailResponse } from "$lib/shared/desktop";

/**
 * One Skill's detail, fetched only after the owner selected it. The list
 * projection carries no paths; this narrow response does, which is why it is a
 * separate authenticated read rather than a field on the summary.
 */
export const GET: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
  try {
    const detail = getSkillManager().getDetail(id);
    const response: DesktopSkillManagerDetailResponse = { ok: true, detail };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
};

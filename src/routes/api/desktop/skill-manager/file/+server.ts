import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getSkillManager } from "$lib/server/app/skillManager";
import type { DesktopSkillFileResponse } from "$lib/shared/desktop";

/**
 * Preview one text file inside a Skill directory. The client sends the opaque
 * Skill id plus a Skill-relative path; the service resolves both and re-checks
 * that the resolved file stays inside the Skill.
 */
export const GET: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  const relativePath = String(url.searchParams.get("path") ?? "").trim();
  if (!id || !relativePath) return json({ ok: false, error: "id and path are required" }, { status: 400 });
  try {
    const file = getSkillManager().readFile(id, relativePath);
    const response: DesktopSkillFileResponse = { ok: true, path: relativePath, ...file };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
};

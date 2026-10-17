import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { findDesktopSkillSource, readSkillFileContent } from "$lib/server/app/desktopSkills";
import type { SharedSkillsResponse } from "$lib/server/app/desktopSkills";
import type { DesktopSkillFileResponse } from "$lib/shared/desktop";

import { GET as listSkills } from "../../../settings/skills/+server";

/**
 * Preview one text file inside a Skill directory.
 *
 * Both the Skill and the file are resolved server-side: the client sends the
 * opaque Skill id plus a Skill-relative path, and `readSkillFileContent`
 * re-checks the resolved path (after symlink expansion) stays inside the Skill
 * directory.
 */
export const GET: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  const relativePath = String(url.searchParams.get("path") ?? "").trim();
  if (!id || !relativePath) return json({ ok: false, error: "id and path are required" }, { status: 400 });

  const result = await listSkills(undefined as never);
  const payload = (await result.json()) as SharedSkillsResponse & { ok?: boolean };
  if (!payload.ok) return json({ ok: false, error: "Failed to list skills" }, { status: 500 });

  const source = findDesktopSkillSource(payload, id);
  if (!source?.filePath) return json({ ok: false, error: "Unknown skill" }, { status: 404 });

  try {
    const baseDir = source.baseDir ?? path.dirname(source.filePath);
    const file = readSkillFileContent(baseDir, relativePath);
    const response: DesktopSkillFileResponse = { ok: true, path: relativePath, ...file };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

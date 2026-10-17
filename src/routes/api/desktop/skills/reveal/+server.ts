import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { findDesktopSkillSource } from "$lib/server/app/desktopSkills";
import type { SharedSkillsResponse } from "$lib/server/app/desktopSkills";
import { revealAbsolutePath, revealSupported } from "$lib/server/web/revealFile";
import type { DesktopSkillRevealRequest } from "$lib/shared/desktop";

import { GET as listSkills } from "../../../settings/skills/+server";

/**
 * Selects a Skill's directory in macOS Finder.
 *
 * The revealed path is resolved from the server-side scan by the opaque Skill
 * id — the client never sends a path, so it cannot reveal an arbitrary
 * location.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as DesktopSkillRevealRequest | null;
  const id = String(body?.id ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });

  const result = await listSkills(undefined as never);
  const payload = (await result.json()) as SharedSkillsResponse & { ok?: boolean };
  if (!payload.ok) return json({ ok: false, error: "Failed to list skills" }, { status: 500 });

  const source = findDesktopSkillSource(payload, id);
  if (!source?.filePath) return json({ ok: false, error: "Unknown skill" }, { status: 404 });

  const baseDir = source.baseDir ?? path.dirname(source.filePath);
  if (!revealSupported()) return json({ ok: false, path: baseDir, error: "Revealing files is only supported on macOS." }, { status: 400 });

  revealAbsolutePath(baseDir, "reveal");
  return json({ ok: true, path: baseDir }, { headers: { "Cache-Control": "no-store" } });
};

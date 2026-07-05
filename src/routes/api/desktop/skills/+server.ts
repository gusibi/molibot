import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopSkillSearchSettings, buildDesktopSkillsSummary, resolveDesktopSkillPath } from "$lib/server/app/desktopSkills";
import { getRuntime } from "$lib/server/app/runtime";
import { updateSkillsConfig } from "$lib/server/settings/handlers/skills";
import type { DesktopSkillsResponse, DesktopSkillsUpdateRequest } from "$lib/shared/desktop";

// The shared skills route's GET handler scans skill files and returns the full
// response (absolute paths, diagnostics, and the credential-bearing skill-search
// api key). It ignores its RequestEvent argument, so we reuse it here and then
// project the result through the path/credential-safe desktop mapper instead of
// duplicating the file-scanning logic.
import { GET as listSkills } from "../../settings/skills/+server";

export const GET: RequestHandler = async () => {
  const result = await listSkills(undefined as never);
  const payload = (await result.json()) as { ok?: boolean };
  if (!payload.ok) {
    return json({ ok: false, error: "Failed to list skills" }, { status: 500 });
  }

  const summary = buildDesktopSkillsSummary(payload as Parameters<typeof buildDesktopSkillsSummary>[0]);
  const response: DesktopSkillsResponse = { ok: true, summary };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as DesktopSkillsUpdateRequest;
    const runtime = getRuntime();
    if (body.kind === "skill") {
      const result = await listSkills(undefined as never);
      const payload = await result.json() as Parameters<typeof resolveDesktopSkillPath>[0];
      const path = resolveDesktopSkillPath(payload, body.id);
      const disabled = new Set(runtime.getSettings().disabledSkillPaths ?? []);
      body.enabled ? disabled.delete(path) : disabled.add(path);
      updateSkillsConfig(runtime, { disabledSkillPaths: [...disabled] });
    } else if (body.kind === "search") {
      const skillSearch = buildDesktopSkillSearchSettings(runtime.getSettings(), body);
      updateSkillsConfig(runtime, { skillSearch });
    } else {
      throw new Error("Unsupported skills update");
    }
    return GET(undefined as never);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

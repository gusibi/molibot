import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildComposerSuggestions } from "$lib/server/app/composerSuggestions";
import { buildDesktopSkillItem, buildDesktopSkillsSummary } from "$lib/server/app/desktopSkills";
import { isChineseLocale } from "$lib/server/agent/commands/i18n";
import { getRuntime } from "$lib/server/app/runtime";
import type { DesktopComposerSuggestionsResponse } from "$lib/shared/desktop";
import { GET as listSkills } from "../../settings/skills/+server";
import { getProjectStore } from "$lib/server/projects/store";
import { resolveRuntimeContext } from "$lib/server/web/runtimeContext";
import { loadSkillsFromWorkspace } from "$lib/server/agent/skills/skills";
import { sanitizeWebProfileId } from "$lib/server/web/identity";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const projectId = String(url.searchParams.get("projectId") ?? "").trim();
  let skills;
  if (projectId) {
    const project = getProjectStore().get(projectId);
    if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
    const profileId = sanitizeWebProfileId(url.searchParams.get("profileId") ?? "personal");
    const { store } = resolveRuntimeContext({ profileId, projectId });
    skills = loadSkillsFromWorkspace(store.getWorkspaceDir(), undefined, {
      disabledSkillPaths: runtime.getSettings().disabledSkillPaths,
      projectRoot: project.rootPath
    }).skills.map(buildDesktopSkillItem);
  } else {
    const result = await listSkills(undefined as never);
    const payload = await result.json() as Parameters<typeof buildDesktopSkillsSummary>[0] & { ok?: boolean };
    if (!payload.ok) return json({ ok: false, error: "Failed to list composer suggestions" }, { status: 500 });
    skills = buildDesktopSkillsSummary(payload).items;
  }
  const locale = isChineseLocale(runtime.getSettings().locale) ? "zh" : "en";
  const response: DesktopComposerSuggestionsResponse = {
    ok: true,
    suggestions: buildComposerSuggestions(skills, locale)
  };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

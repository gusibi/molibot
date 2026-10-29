import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createHash } from "node:crypto";
import { buildComposerSuggestions } from "$lib/server/app/composerSuggestions";
import { isChineseLocale } from "$lib/server/agent/commands/i18n";
import { getRuntime } from "$lib/server/app/runtime";
import type { DesktopComposerSuggestionsResponse, DesktopSkillItem, DesktopSkillScope } from "$lib/shared/desktop";
import { getProjectStore } from "$lib/server/projects/store";
import { resolveRuntimeContext } from "$lib/server/web/runtimeContext";
import { loadSkillsFromWorkspace } from "$lib/server/agent/skills/skills";
import { sanitizeWebProfileId } from "$lib/server/web/identity";
import { buildDesktopMiniApps } from "$lib/server/app/desktopMiniApps";
import { getMiniAppHost } from "$lib/server/miniapps/registry";

/**
 * The composer only needs identity, name and enabled state. Ids are opaque so
 * the suggestion payload still carries no filesystem path.
 */
function composerSkill(filePath: string, name: string, description: string, scope: string, enabled: boolean): DesktopSkillItem {
  const mapped: DesktopSkillScope = scope === "project"
    ? "project"
    : scope === "chat"
      ? "chat"
      : scope === "bot" || scope === "agent"
        ? "agent"
        : "global";
  return {
    id: createHash("sha256").update(filePath).digest("hex").slice(0, 16),
    name,
    description,
    scope: mapped,
    enabled,
    mcpServerCount: 0,
    agentId: scope === "bot" || scope === "agent" ? "agent" : "",
    chatId: ""
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const projectId = String(url.searchParams.get("projectId") ?? "").trim();
  let skills;
  let projectCommands: import("$lib/server/projects/store").ProjectCustomCommand[] = [];
  if (projectId) {
    const project = getProjectStore().get(projectId);
    if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });
    projectCommands = project.customCommands ?? [];
    const profileId = sanitizeWebProfileId(url.searchParams.get("profileId") ?? "personal");
    const { store } = resolveRuntimeContext({ profileId, projectId });
    skills = loadSkillsFromWorkspace(store.getWorkspaceDir(), undefined, {
      disabledSkillPaths: runtime.getSettings().disabledSkillPaths,
      projectRoot: project.rootPath
    }).skills.map((skill) => composerSkill(skill.filePath, skill.name, skill.description, skill.scope, true));
  } else {
    const profileId = sanitizeWebProfileId(url.searchParams.get("profileId") ?? "personal");
    const { store } = resolveRuntimeContext({ profileId });
    skills = loadSkillsFromWorkspace(store.getWorkspaceDir(), undefined, {
      disabledSkillPaths: runtime.getSettings().disabledSkillPaths
    }).skills.map((skill) => composerSkill(skill.filePath, skill.name, skill.description, skill.scope, true));
  }
  const locale = isChineseLocale(runtime.getSettings().locale) ? "zh" : "en";
  // A broken or unavailable Mini App host must not empty the command palette.
  let miniApps: ReturnType<typeof buildDesktopMiniApps> = [];
  try {
    miniApps = buildDesktopMiniApps(getMiniAppHost().listCatalog());
  } catch {
    miniApps = [];
  }
  const response: DesktopComposerSuggestionsResponse = {
    ok: true,
    suggestions: buildComposerSuggestions(skills, locale, miniApps, projectCommands)
  };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

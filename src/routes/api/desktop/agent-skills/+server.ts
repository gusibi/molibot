import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage";
import { storagePaths } from "$lib/server/infra/db/storage";
import { loadSkillsFromWorkspace } from "$lib/server/agent/skills/skills";

export const GET: RequestHandler = ({ url }) => {
  const id = url.searchParams.get("agentId") ?? "";
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === "." || id === "..") return json({ ok: false, error: "Invalid Agent ID" }, { status: 400 });
  const settings = getRuntime().getSettings();
  const { skills, diagnostics } = loadSkillsFromWorkspace(agentWorkspaceDir(storagePaths.dataDir, id), undefined, { disabledSkillPaths: settings.disabledSkillPaths });
  // The runtime tags the workspace layer "bot"; this route serves one Agent's
  // workspace by definition, so the boundary emits the agent scope.
  return json({ ok: true, skills: skills.map(skill => ({ name: skill.name, description: skill.description, path: skill.filePath, scope: skill.scope === "bot" ? "agent" : skill.scope })), diagnostics }, { headers: { "Cache-Control": "no-store" } });
};

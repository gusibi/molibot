import { getProjectStore } from "$lib/server/projects/store.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { updateSkillsConfig } from "$lib/server/settings/handlers/skills.js";
import { applyBuiltinSkill } from "$lib/server/agent/skills/bootstrap.js";
import { SkillManager } from "$lib/server/skills/manager.js";
import { SkillManagerStore } from "$lib/server/skills/store.js";

let store: SkillManagerStore | null = null;

export function getSkillManagerStore(): SkillManagerStore {
  store ??= new SkillManagerStore(`${storagePaths.dbDir}/skills.sqlite`);
  return store;
}

/**
 * The production Skill Manager: it reads live settings, registered projects
 * and Agent workspaces, and writes enable state through the same entity-level
 * settings handler the rest of the app uses.
 */
export function getSkillManager(): SkillManager {
  const runtime = getRuntime();
  return new SkillManager({
    store: getSkillManagerStore(),
    dataDir: storagePaths.dataDir,
    globalSkillsDir: storagePaths.globalSkillsDir,
    agentsDir: storagePaths.sessionsDir,
    projects: () =>
      getProjectStore()
        .list()
        .map((project) => ({ id: project.id, name: project.name, rootPath: project.rootPath })),
    getDisabledPaths: () => runtime.getSettings().disabledSkillPaths ?? [],
    setDisabledPaths: (paths) => {
      updateSkillsConfig(runtime, { disabledSkillPaths: paths });
    },
    getAgentLabel: (id) => runtime.getSettings().agents?.find((agent) => agent.id === id)?.name ?? id,
    defaultAgentId: () => runtime.getSettings().defaultAgentId || "",
    platform: process.platform
  });
}

/** Write the shipped copy of a built-in Skill over the owner's copy. */
export function updateBuiltinSkill(id: string): void {
  applyBuiltinSkill({ skillsRoot: storagePaths.globalSkillsDir, id: String(id ?? "") });
}

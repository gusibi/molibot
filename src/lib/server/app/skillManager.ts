import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { getProjectStore } from "$lib/server/projects/store.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { updateSkillsConfig } from "$lib/server/settings/handlers/skills.js";
import { applyBuiltinSkill } from "$lib/server/agent/skills/bootstrap.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { SkillManager } from "$lib/server/skills/manager.js";
import { SkillManagerStore } from "$lib/server/skills/store.js";

let store: SkillManagerStore | null = null;
let traceStore: SqliteTraceStore | null = null;

export function getSkillManagerStore(): SkillManagerStore {
  store ??= new SkillManagerStore(`${storagePaths.dbDir}/skills.sqlite`);
  return store;
}

function getTraceStore(): SqliteTraceStore {
  traceStore ??= new SqliteTraceStore();
  return traceStore;
}

/** Resolve a binary the same way a login shell would, without spawning one. */
function commandAvailable(binary: string): boolean {
  const name = String(binary ?? "").trim();
  if (!name) return false;
  if (name.includes("/")) {
    try {
      accessSync(name, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep looking: a non-executable earlier in PATH must not hide a later match.
    }
  }
  return false;
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
    platform: process.platform,
    traceStore: getTraceStore(),
    getMcpServers: () =>
      (runtime.getSettings().mcpServers ?? []).map((server) => ({
        id: server.id,
        enabled: server.enabled !== false
      })),
    hasCommand: commandAvailable
  });
}

/** Write the shipped copy of a built-in Skill over the owner's copy. */
export function updateBuiltinSkill(id: string): void {
  applyBuiltinSkill({ skillsRoot: storagePaths.globalSkillsDir, id: String(id ?? "") });
}

import path from "node:path";
import type { RunnerPool } from "$lib/server/agent/core/runnerPool.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

/**
 * Process-wide cache of project runtime workspaces (`<dataRoot>/projects/<id>/runtime`).
 *
 * Both the Web/Desktop runtime router and the channel Project-mode router MUST
 * resolve a project's {store, pool} through this cache: two pools over the same
 * workspace would each hold a MomRunner writing the same context file and
 * clobber each other. This module is a dependency leaf (no app/runtime or
 * channel imports) so either side can reach it without import cycles.
 */
export interface ProjectRuntimeHandle {
  store: MomRuntimeStore;
  pool: RunnerPool;
}

const projectRuntimes = new Map<string, ProjectRuntimeHandle>();

/** Mirrors the project directory sanitizer in sessions/store.ts so the runtime
 * workspace sits alongside the project's session store under the same slug. */
export function sanitizeProjectDirPart(value: string): string {
  const safe = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "project";
}

export function projectRuntimeWorkspaceDir(projectId: string): string {
  return path.join(storagePaths.projectsDir, sanitizeProjectDirPart(projectId), "runtime");
}

export function getOrCreateProjectRuntimeHandle(
  projectId: string,
  create: () => ProjectRuntimeHandle
): ProjectRuntimeHandle {
  const key = sanitizeProjectDirPart(projectId);
  const existing = projectRuntimes.get(key);
  if (existing) return existing;
  const created = create();
  projectRuntimes.set(key, created);
  return created;
}

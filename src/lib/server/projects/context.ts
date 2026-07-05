import fs from "node:fs";
import type { ProjectRecord } from "./store.js";
import { getProjectStore } from "./store.js";

export type ProjectContextResult =
  | { ok: true; project?: ProjectRecord }
  | { ok: false; status: 404 | 409; error: string };

export function resolveProjectContext(projectId?: string): ProjectContextResult {
  const id = String(projectId ?? "").trim();
  if (!id) return { ok: true };
  const project = getProjectStore().get(id);
  if (!project) return { ok: false, status: 404, error: "Unknown project" };
  try {
    if (!fs.existsSync(project.rootPath) || !fs.statSync(project.rootPath).isDirectory()) {
      return { ok: false, status: 409, error: `Project directory missing: ${project.rootPath}` };
    }
  } catch {
    return { ok: false, status: 409, error: `Project directory missing: ${project.rootPath}` };
  }
  return { ok: true, project };
}

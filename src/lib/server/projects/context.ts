import fs from "node:fs";
import type { MomContext } from "$lib/server/agent/core/types.js";
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

/**
 * Build the runner-facing project context. Every site that starts a run for a
 * project conversation (web send, SSE stream, channel runtime, approval
 * auto-resume) needs the exact same projection; hand-building it per call site
 * is how the approval resume path ended up running project-less — with the
 * scratch dir as cwd instead of the project root.
 */
export function buildRunnerProjectContext(
  project: ProjectRecord | null | undefined,
  scratchDir: string
): MomContext["project"] | undefined {
  if (!project) return undefined;
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    instructions: project.instructions,
    sandboxEnabled: project.sandboxEnabled,
    toolProgress: project.toolProgress,
    showReasoning: project.showReasoning,
    runLogNotice: project.runLogNotice,
    scratchDir
  };
}

/** Resolve the project a conversation belongs to, if any. */
export function getConversationProject(
  sessions: { getConversationProjectId: (id: string) => string | null | undefined },
  conversationId: string | null | undefined
): ProjectRecord | null {
  const id = String(conversationId ?? "").trim();
  if (!id) return null;
  const projectId = sessions.getConversationProjectId(id);
  if (!projectId) return null;
  return getProjectStore().get(projectId) ?? null;
}

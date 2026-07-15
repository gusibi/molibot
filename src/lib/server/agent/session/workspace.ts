import { resolve } from "node:path";

const CHANNEL_WORKSPACE_MARKER = /\/(moli-[^/]+)\//;
// Project runtime workspaces live at `<dataRoot>/projects/<projectId>/runtime`.
// The marker is intentionally specific (requires the `/<id>/runtime` tail) so a
// stray `projects` segment in an ancestor path can never be mistaken for it.
const PROJECT_WORKSPACE_MARKER = /\/(projects)\/[^/]+\/runtime(?:\/|$)/;

function normalizedResolved(pathLike: string): string {
  return resolve(pathLike).replace(/\\/g, "/");
}

function findWorkspaceMarker(pathLike: string): { marker: string; markerIndex: number } | null {
  const normalized = normalizedResolved(pathLike);
  const channel = CHANNEL_WORKSPACE_MARKER.exec(normalized);
  if (channel && typeof channel.index === "number") {
    return { marker: channel[1], markerIndex: channel.index };
  }
  const project = PROJECT_WORKSPACE_MARKER.exec(normalized);
  if (project && typeof project.index === "number") {
    return { marker: project[1], markerIndex: project.index };
  }
  return null;
}

export function resolveDataRootFromWorkspacePath(pathLike: string): string {
  const normalized = normalizedResolved(pathLike);
  const marker = findWorkspaceMarker(pathLike);
  if (!marker) return normalized;
  return resolve(normalized.slice(0, marker.markerIndex));
}

export function resolveWorkspaceRelativeFromWorkspacePath(pathLike: string): string {
  const normalized = normalizedResolved(pathLike);
  const marker = findWorkspaceMarker(pathLike);
  if (!marker) return "workspace";
  return normalized.slice(marker.markerIndex + 1);
}

export function resolveMemoryRootFromWorkspacePath(pathLike: string): string {
  return resolve(resolveDataRootFromWorkspacePath(pathLike), "memory");
}

export function resolveGlobalSkillsDirFromWorkspacePath(pathLike: string): string {
  return resolve(resolveDataRootFromWorkspacePath(pathLike), "skills");
}

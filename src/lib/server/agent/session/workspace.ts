import { resolve } from "node:path";

const CHANNEL_WORKSPACE_MARKER = /\/(moli-[^/]+)\//g;
// Project runtime workspaces live at `<dataRoot>/projects/<projectId>/runtime`.
// The marker is intentionally specific (requires the `/<id>/runtime` tail) so a
// stray `projects` segment in an ancestor path can never be mistaken for it.
const AGENT_WORKSPACE_MARKER = /\/(sessions|channels)\/[^/]+(?=\/|$)/g;
const PROJECT_WORKSPACE_MARKER = /\/(projects)\/[^/]+\/runtime(?:\/|$)/g;

function normalizedResolved(pathLike: string): string {
  return resolve(pathLike).replace(/\\/g, "/");
}

function findWorkspaceMarker(pathLike: string): { marker: string; markerIndex: number } | null {
  const normalized = normalizedResolved(pathLike);
  const matches = [CHANNEL_WORKSPACE_MARKER, AGENT_WORKSPACE_MARKER, PROJECT_WORKSPACE_MARKER]
    .flatMap(marker => [...normalized.matchAll(marker)])
    .sort((a, b) => b.index! - a.index!);
  const match = matches[0];
  if (match) return { marker: match[1], markerIndex: match.index! };
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

/**
 * Mini App *code* root (`<dataRoot>/miniapps/apps`). Must stay in step with
 * `storagePaths.miniAppCodeDir`; this derivation exists so the file-tool path
 * guard can allow it without importing the server config.
 *
 * Only `apps/` is derived here. `miniapps/data/` holds each app's private
 * SQLite database and stays off-limits to the generic file tools — an app's
 * data is reached through its own tools, never by writing the file underneath
 * a live connection.
 */
export function resolveMiniAppCodeRootFromWorkspacePath(pathLike: string): string {
  return resolve(resolveDataRootFromWorkspacePath(pathLike), "miniapps", "apps");
}

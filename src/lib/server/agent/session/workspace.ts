import { resolve } from "node:path";

const CHANNEL_WORKSPACE_MARKER = /\/(moli-[^/]+)\//;

function normalizedResolved(pathLike: string): string {
  return resolve(pathLike).replace(/\\/g, "/");
}

function findWorkspaceMarker(pathLike: string): { marker: string; markerIndex: number } | null {
  const normalized = normalizedResolved(pathLike);
  const match = CHANNEL_WORKSPACE_MARKER.exec(normalized);
  if (!match || typeof match.index !== "number") return null;
  return {
    marker: match[1],
    markerIndex: match.index
  };
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

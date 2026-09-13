import { isAbsolute, relative, resolve } from "node:path";

export type FileRootKind = "project" | "scratch" | "attachment";
export type FileToolAction = "created" | "modified" | "generated" | "attached";

export interface FileToolDetails {
  requestedPath?: string;
  relativePath: string;
  rootKind: FileRootKind;
  action: FileToolAction;
  sizeBytes?: number;
}

export interface RunOutputLayout {
  projectRoot?: string;
  scratchRoot: string;
  /**
   * Directory that a scratch `relativePath` is measured from. Files are written
   * into `scratchRoot` (the dated artifact folder), but the rest of the system —
   * the Session file list and the transcript file card — resolves those paths
   * from the scratch root, so the receipt must include the dated segment
   * (`2026/09/14/report.html`), not just the basename.
   */
  scratchBase?: string;
}

export function buildRunOutputLayout(input: {
  cwd: string;
  scratchRoot: string;
  scratchBase?: string;
  projectRoot?: string;
}): RunOutputLayout {
  return {
    projectRoot: input.projectRoot ? resolve(input.projectRoot) : undefined,
    scratchRoot: resolve(input.scratchRoot),
    ...(input.scratchBase ? { scratchBase: resolve(input.scratchBase) } : {})
  };
}

/** Base a reported path is measured from for the given root kind. */
export function outputReportBase(layout: RunOutputLayout, rootKind: "project" | "scratch"): string {
  return rootKind === "project"
    ? layout.projectRoot ?? layout.scratchRoot
    : layout.scratchBase ?? layout.scratchRoot;
}

export function describeFileToolResult(
  layout: RunOutputLayout,
  filePath: string,
  action: FileToolAction,
  requestedPath?: string,
  sizeBytes?: number
): FileToolDetails | undefined {
  const target = resolve(filePath);
  const roots: Array<{ rootKind: FileRootKind; root: string }> = [
    { rootKind: "scratch", root: resolve(outputReportBase(layout, "scratch")) },
    ...(layout.projectRoot ? [{ rootKind: "project" as const, root: resolve(layout.projectRoot) }] : [])
  ];
  for (const candidate of roots) {
    const rel = relative(candidate.root, target);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return {
        requestedPath,
        relativePath: rel.replaceAll("\\", "/"),
        rootKind: candidate.rootKind,
        action,
        sizeBytes
      };
    }
  }
  return undefined;
}

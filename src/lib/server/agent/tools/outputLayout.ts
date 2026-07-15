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
}

export function buildRunOutputLayout(input: {
  cwd: string;
  scratchRoot: string;
  projectRoot?: string;
}): RunOutputLayout {
  return {
    projectRoot: input.projectRoot ? resolve(input.projectRoot) : undefined,
    scratchRoot: resolve(input.scratchRoot)
  };
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
    { rootKind: "scratch", root: resolve(layout.scratchRoot) },
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

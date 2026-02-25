import { basename, isAbsolute, relative, resolve } from "node:path";

const GLOBAL_PROFILE_FILES = ["SOUL.md", "TOOLS.md", "BOOTSTRAP.md", "IDENTITY.md", "USER.md"] as const;

function resolveDataRootFromWorkspacePath(pathLike: string): string {
  const normalized = resolve(pathLike).replace(/\\/g, "/");
  const marker = "/moli-t/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex > 0) {
    return resolve(normalized.slice(0, markerIndex));
  }
  return resolve(normalized);
}

function resolveGlobalProfilePath(baseDir: string, input: string): string | null {
  const normalizedInput = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const fileName = basename(normalizedInput);
  const matched = GLOBAL_PROFILE_FILES.find((name) => fileName.toLowerCase() === name.toLowerCase());
  if (!matched) return null;
  const dataRoot = resolveDataRootFromWorkspacePath(baseDir);
  return resolve(dataRoot, matched);
}

export function resolveToolPath(baseDir: string, input: string): string {
  if (isAbsolute(input)) return input;

  const globalProfile = resolveGlobalProfilePath(baseDir, input);
  if (globalProfile) return globalProfile;

  const normalizedBase = resolve(baseDir).replace(/\\/g, "/");

  // Tools run under chat scratch dir; normalize accidentally duplicated prefixes.
  const normalizedInput = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const duplicatedScratchPrefix = normalizedInput.match(/^data\/(?:telegram-mom|moli-t)\/[^/]+\/scratch\/(.+)$/);
  if (duplicatedScratchPrefix?.[1]) {
    return resolve(baseDir, duplicatedScratchPrefix[1]);
  }

  // Normalize common skill path mistakes when tools run inside chat scratch.
  // Example:
  //   cwd: .../.molibot/moli-t/<chatId>/scratch
  //   input: data/moli-t/skills/brave-search/SKILL.md
  // Should resolve to:
  //   .../.molibot/moli-t/skills/brave-search/SKILL.md
  const workspaceFromScratch = normalizedBase.match(/^(.*)\/[^/]+\/scratch(?:\/.*)?$/)?.[1];
  const workspaceSkillsPrefix = normalizedInput.match(/^data\/(?:telegram-mom|moli-t)\/skills(?:\/(.*))?$/);
  if (workspaceFromScratch && workspaceSkillsPrefix) {
    const suffix = workspaceSkillsPrefix[1] ?? "";
    return resolve(workspaceFromScratch, "skills", suffix);
  }

  // Normalize shared memory paths to DATA_DIR/memory when called from chat scratch.
  // Example:
  //   cwd: .../.molibot/moli-t/bots/<bot>/<chatId>/scratch
  //   input: memory/moli-t/bots/<bot>/<chatId>/MEMORY.md
  // Should resolve to:
  //   .../.molibot/memory/moli-t/bots/<bot>/<chatId>/MEMORY.md
  const memoryPrefix = normalizedInput.match(/^memory(?:\/(.*))?$/);
  if (workspaceFromScratch && memoryPrefix) {
    const normalizedWorkspaceFromScratch = workspaceFromScratch.replace(/\\/g, "/");
    const marker = "/moli-t/";
    const markerIndex = normalizedWorkspaceFromScratch.indexOf(marker);
    const dataRoot = markerIndex > 0
      ? normalizedWorkspaceFromScratch.slice(0, markerIndex)
      : normalizedWorkspaceFromScratch;
    const suffix = memoryPrefix[1] ?? "";
    return resolve(dataRoot, "memory", suffix);
  }

  return resolve(baseDir, input);
}

export function createPathGuard(cwd: string, workspaceDir: string): (filePath: string) => void {
  const workspaceResolved = resolve(workspaceDir);
  const normalizedWorkspace = workspaceResolved.replace(/\\/g, "/");
  const dataRoot = resolveDataRootFromWorkspacePath(workspaceResolved);
  const memoryRoot = normalizedWorkspace.includes("/moli-t/")
    ? resolve(`${normalizedWorkspace.slice(0, normalizedWorkspace.indexOf("/moli-t/"))}/memory`)
    : resolve(workspaceResolved, "memory");
  const allowedRoots = [resolve(cwd), workspaceResolved];
  const allowedGlobalProfilePaths = GLOBAL_PROFILE_FILES.map((file) =>
    resolve(dataRoot, file),
  );
  return (filePath: string): void => {
    const resolved = resolve(filePath);
    const memoryRel = relative(memoryRoot, resolved);
    const isMemoryPath = memoryRel === "" || (!memoryRel.startsWith("..") && !isAbsolute(memoryRel));
    if (isMemoryPath) {
      throw new Error(
        `Memory files must be managed via the memory gateway tool/API, not direct file tools. Blocked path: ${resolved}`
      );
    }
    if (allowedGlobalProfilePaths.includes(resolved)) {
      return;
    }
    const resolvedBase = basename(resolved).toLowerCase();
    const isGlobalProfileTarget = GLOBAL_PROFILE_FILES.some(
      (file) => file.toLowerCase() === resolvedBase,
    );
    if (isGlobalProfileTarget) {
      throw new Error(
        `Global profile files must be written only under data root. Use ${allowedGlobalProfilePaths.join(", ")}. Blocked path: ${resolved}`
      );
    }
    const ok = allowedRoots.some((root) => {
      const rel = relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
    if (!ok) {
      throw new Error(
        `Path outside allowed workspace roots: ${resolved}. Use paths under ${allowedRoots.join(" or ")}.`
      );
    }
  };
}

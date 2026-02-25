import { isAbsolute, relative, resolve } from "node:path";

export function resolveToolPath(baseDir: string, input: string): string {
  if (isAbsolute(input)) return input;

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
  const memoryRoot = normalizedWorkspace.includes("/moli-t/")
    ? resolve(`${normalizedWorkspace.slice(0, normalizedWorkspace.indexOf("/moli-t/"))}/memory`)
    : resolve(workspaceResolved, "memory");
  const allowedRoots = [resolve(cwd), workspaceResolved];
  return (filePath: string): void => {
    const resolved = resolve(filePath);
    const memoryRel = relative(memoryRoot, resolved);
    const isMemoryPath = memoryRel === "" || (!memoryRel.startsWith("..") && !isAbsolute(memoryRel));
    if (isMemoryPath) {
      throw new Error(
        `Memory files must be managed via the memory gateway tool/API, not direct file tools. Blocked path: ${resolved}`
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

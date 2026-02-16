import { isAbsolute, relative, resolve } from "node:path";

export function resolveToolPath(baseDir: string, input: string): string {
  if (isAbsolute(input)) return input;

  const normalizedBase = resolve(baseDir).replace(/\\/g, "/");

  // Tools run under chat scratch dir; normalize accidentally duplicated prefixes.
  const normalizedInput = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const duplicatedScratchPrefix = normalizedInput.match(/^data\/telegram-mom\/[^/]+\/scratch\/(.+)$/);
  if (duplicatedScratchPrefix?.[1]) {
    return resolve(baseDir, duplicatedScratchPrefix[1]);
  }

  // Normalize common skill path mistakes when tools run inside chat scratch.
  // Example:
  //   cwd: .../data/telegram-mom/<chatId>/scratch
  //   input: data/telegram-mom/skills/brave-search/SKILL.md
  // Should resolve to:
  //   .../data/telegram-mom/skills/brave-search/SKILL.md
  const workspaceFromScratch = normalizedBase.match(/^(.*\/data\/telegram-mom)\/[^/]+\/scratch(?:\/.*)?$/)?.[1];
  const workspaceSkillsPrefix = normalizedInput.match(/^data\/telegram-mom\/skills(?:\/(.*))?$/);
  if (workspaceFromScratch && workspaceSkillsPrefix) {
    const suffix = workspaceSkillsPrefix[1] ?? "";
    return resolve(workspaceFromScratch, "skills", suffix);
  }

  return resolve(baseDir, input);
}

export function createPathGuard(cwd: string, workspaceDir: string): (filePath: string) => void {
  const allowedRoots = [resolve(cwd), resolve(workspaceDir)];
  return (filePath: string): void => {
    const resolved = resolve(filePath);
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

import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  resolveDataRootFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath
} from "../workspace.js";

const GLOBAL_PROFILE_FILES = ["SOUL.md", "TOOLS.md", "BOOTSTRAP.md", "IDENTITY.md", "USER.md"] as const;

function pathCompareKey(pathLike: string): string {
  const resolved = resolve(pathLike);
  if (process.platform === "darwin" || process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
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
  const globalProfile = resolveGlobalProfilePath(baseDir, input);
  if (globalProfile) return globalProfile;

  if (isAbsolute(input)) return input;

  const normalizedBase = resolve(baseDir).replace(/\\/g, "/");

  // Tools run under chat scratch dir; normalize accidentally duplicated prefixes.
  const normalizedInput = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const duplicatedScratchPrefix = normalizedInput.match(/^data\/(?:telegram-mom|moli-[^/]+)\/[^/]+\/scratch\/(.+)$/);
  if (duplicatedScratchPrefix?.[1]) {
    return resolve(baseDir, duplicatedScratchPrefix[1]);
  }

  // Normalize common skill path mistakes when tools run inside chat scratch.
  // Example:
  //   cwd: .../.molibot/moli-t/<chatId>/scratch
  //   input: data/moli-t/skills/brave-search/SKILL.md
  // Should resolve to:
  //   .../.molibot/skills/brave-search/SKILL.md
  const workspaceFromScratch = normalizedBase.match(/^(.*)\/[^/]+\/scratch(?:\/.*)?$/)?.[1];
  const workspaceSkillsPrefix = normalizedInput.match(/^data\/(?:telegram-mom|moli-[^/]+)\/skills(?:\/(.*))?$/);
  if (workspaceFromScratch && workspaceSkillsPrefix) {
    const dataRoot = resolveDataRootFromWorkspacePath(workspaceFromScratch);
    const suffix = workspaceSkillsPrefix[1] ?? "";
    return resolve(dataRoot, "skills", suffix);
  }

  // Normalize chat-local skill path when explicitly referencing chat scope.
  // Example:
  //   input: data/moli-t/<chatId>/skills/my-task/SKILL.md
  // Should resolve to:
  //   .../.molibot/moli-t/<chatId>/skills/my-task/SKILL.md
  const chatSkillsPrefix = normalizedInput.match(/^data\/(?:telegram-mom|moli-[^/]+)\/([^/]+)\/skills(?:\/(.*))?$/);
  if (workspaceFromScratch && chatSkillsPrefix) {
    const chatId = chatSkillsPrefix[1] ?? "";
    const suffix = chatSkillsPrefix[2] ?? "";
    return resolve(workspaceFromScratch, chatId, "skills", suffix);
  }

  // Normalize shared memory paths to DATA_DIR/memory when called from chat scratch.
  // Example:
  //   cwd: .../.molibot/moli-t/bots/<bot>/<chatId>/scratch
  //   input: memory/moli-t/bots/<bot>/<chatId>/MEMORY.md
  // Should resolve to:
  //   .../.molibot/memory/moli-t/bots/<bot>/<chatId>/MEMORY.md
  const memoryPrefix = normalizedInput.match(/^memory(?:\/(.*))?$/);
  if (workspaceFromScratch && memoryPrefix) {
    const dataRoot = resolveDataRootFromWorkspacePath(workspaceFromScratch);
    const suffix = memoryPrefix[1] ?? "";
    return resolve(dataRoot, "memory", suffix);
  }

  return resolve(baseDir, input);
}

export function createPathGuard(cwd: string, workspaceDir: string): (filePath: string) => void {
  const workspaceResolved = resolve(workspaceDir);
  const dataRoot = resolveDataRootFromWorkspacePath(workspaceResolved);
  const memoryRoot = resolveMemoryRootFromWorkspacePath(workspaceResolved);
  const globalSkillsRoot = resolve(dataRoot, "skills");
  const allowedRoots = [resolve(cwd), workspaceResolved, globalSkillsRoot];
  const allowedGlobalProfilePaths = GLOBAL_PROFILE_FILES.map((file) =>
    resolve(dataRoot, file),
  );
  const allowedGlobalProfilePathKeys = new Set(
    allowedGlobalProfilePaths.map((path) => pathCompareKey(path)),
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
    if (allowedGlobalProfilePathKeys.has(pathCompareKey(resolved))) {
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

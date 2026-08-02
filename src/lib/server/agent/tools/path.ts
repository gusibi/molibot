import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import {
  resolveDataRootFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath,
  resolveMiniAppCodeRootFromWorkspacePath
} from "$lib/server/agent/session/workspace.js";

const GLOBAL_PROFILE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
  "SONG.md"
] as const;

export function pathCompareKey(pathLike: string): string {
  const resolved = resolve(pathLike);
  if (process.platform === "darwin" || process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
}

/**
 * Expand a leading `~`, `~/` or `$HOME` the way a shell would.
 *
 * The `bash` tool goes through a shell and expands these; the file tools
 * (`ls`/`read`/`write`/`edit`) resolve with `path.resolve`, which treats `~` as
 * an ordinary directory name and silently produces `<cwd>/~/...`. That
 * mismatch made the same path mean two different things depending on which
 * tool the model reached for, and the file tools failed with a confusing
 * "Path not found" instead of pointing at the real problem.
 *
 * Returns null when the input carries no home prefix.
 */
export function expandHomePrefix(input: string): string | null {
  const home = homedir();
  if (!home) return null;
  const normalized = input.replace(/\\/g, "/");
  if (normalized === "~" || normalized === "$HOME" || normalized === "${HOME}") return resolve(home);
  const match = normalized.match(/^(?:~|\$HOME|\$\{HOME\})\/(.*)$/);
  if (!match) return null;
  return resolve(home, match[1] ?? "");
}

export function resolveToolPath(baseDir: string, input: string): string {
  if (input === "") throw new Error("Path is required");

  // Shell-style home prefixes resolve against the real home directory, not
  // against the chat scratch dir. Do this first: an expanded path is absolute
  // and must not fall through the scratch/skill prefix normalizations below.
  const expandedHome = expandHomePrefix(input);
  if (expandedHome) return expandedHome;

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
  // Mini App source lives outside every chat workspace by design (one install,
  // every channel). It is owner-authored code the agent is expected to edit —
  // `miniapp-creator` scaffolds into it and then rewrites `server/index.mjs` —
  // so the file tools must reach it, exactly like the global Skill root.
  const miniAppCodeRoot = resolveMiniAppCodeRootFromWorkspacePath(workspaceResolved);
  const allowedRoots = [resolve(cwd), workspaceResolved, globalSkillsRoot, miniAppCodeRoot];

  // Pre-compute the exact global profile file paths under dataRoot.
  const globalProfilePathKeys = new Set(
    GLOBAL_PROFILE_FILES.map((file) => pathCompareKey(resolve(dataRoot, file))),
  );

  return (filePath: string): void => {
    const resolved = resolve(filePath);

    // Memory files must go through the memory gateway tool.
    const memoryRel = relative(memoryRoot, resolved);
    const isMemoryPath = memoryRel === "" || (!memoryRel.startsWith("..") && !isAbsolute(memoryRel));
    if (isMemoryPath) {
      throw new Error(
        `Memory files must be managed via the memory gateway tool/API, not direct file tools. Blocked path: ${resolved}`
      );
    }

    // Global profile files must go through the profileFiles tool.
    // Only the profileFiles tool may read/write profile files at any scope
    // (bot, agent, global). Generic read/write/edit tools are forbidden from
    // touching global profile paths so that bot-scoped edits cannot
    // accidentally land on the global file.
    if (globalProfilePathKeys.has(pathCompareKey(resolved))) {
      throw new Error(
        `Global profile files must be managed via the profileFiles tool, not direct file tools. Blocked path: ${resolved}`
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

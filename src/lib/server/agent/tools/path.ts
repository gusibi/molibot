import { resolveAgentFileReference } from "$lib/server/sessions/agentFileReferences.js";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { GLOBAL_PROFILE_FILES, getGlobalProfileDir } from "$lib/server/agent/prompts/profiles.js";
import {
  resolveDataRootFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath,
  resolveMiniAppCodeRootFromWorkspacePath
} from "$lib/server/agent/session/workspace.js";

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

export function resolveToolPath(baseDir: string, input: string, source?: Partial<import("$lib/server/sessions/agentStorage.js").SessionSource>): string {
  if (input === "") throw new Error("Path is required");

  // Shell-style home prefixes resolve against the real home directory, not
  // against the chat scratch dir. Do this first: an expanded path is absolute
  // and must not fall through the scratch/skill prefix normalizations below.
  const expandedHome = expandHomePrefix(input);
  if (expandedHome) return expandedHome;

  const normalizedBase = resolve(baseDir).replace(/\\/g, "/");

  const normalizedInput = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const agentWorkspace = normalizedBase.match(/^(.*\/sessions\/[^/]+)(?:\/scratch(?:\/.*)?)?$/)?.[1];
  if (agentWorkspace) {
    const mapped = resolveAgentFileReference(agentWorkspace, input, source);
    if (mapped !== resolve(agentWorkspace, input)) return mapped;
    if (/^(attachments|scratch|skills|run-details)(?:\/|$)/.test(normalizedInput)) return resolve(agentWorkspace, normalizedInput);
  }
  const workspaceFromScratch = agentWorkspace ?? normalizedBase.match(/^(.*)\/[^/]+\/scratch(?:\/.*)?$/)?.[1];

  const memoryPrefix = normalizedInput.match(/^memory(?:\/(.*))?$/);
  if (workspaceFromScratch && memoryPrefix) {
    const dataRoot = resolveDataRootFromWorkspacePath(workspaceFromScratch);
    const suffix = memoryPrefix[1] ?? "";
    return resolve(dataRoot, "memory", suffix);
  }

  return resolve(baseDir, input);
}

/**
 * @param options.hostWideAccess — full access (Auto) removes the workspace-root
 * wall: file tools obey the same effective policy as commands and may touch the
 * whole host (paths still resolve with normal file-tool semantics). The
 * memory-gateway and global-profile routing guards stay in every mode — they
 * protect Molibot's own structural boundaries, not sandbox walls.
 */
export function createPathGuard(cwd: string, workspaceDir: string, options?: { hostWideAccess?: boolean }): (filePath: string) => void {
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

  // Pre-compute the exact global profile file paths inside the global profile
  // dir (agents/default under the data root).
  const globalProfilePathKeys = new Set(
    GLOBAL_PROFILE_FILES.map((file) => pathCompareKey(resolve(getGlobalProfileDir(dataRoot), file))),
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

    if (/^moli-[^/]+(?:\/|$)/.test(relative(dataRoot, resolved).replaceAll("\\", "/"))) {
      throw new Error("Legacy Channel snapshots are read-only; use the Agent workspace.");
    }
    if (options?.hostWideAccess === true) return;
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

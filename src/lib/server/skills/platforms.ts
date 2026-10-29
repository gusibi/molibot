import { join } from "node:path";
import type { ResolvedPlatformRoot, SkillPlatformConfigRecord } from "$lib/server/skills/types.js";

/**
 * Platform presets.
 *
 * A platform is a *read rule*: where a tool looks for SKILL.md files and
 * whether Molibot writes there. It is never an installation owner — two tools
 * may read the same physical directory, and the manager keeps that visibility
 * relationship instead of inventing a second installation.
 *
 * `verified` records whether the paths were checked against the vendor's own
 * documentation. An adapter existing in this table does not mean it was ever
 * exercised on this machine; the UI must say so rather than imply support.
 */

export interface PlatformScanContext {
  homeDir: string;
  dataDir: string;
  projects: Array<{ id: string; name: string; rootPath: string }>;
}

export interface PlatformPreset {
  id: string;
  label: string;
  /** Whether Molibot may write into this platform's global roots. */
  writable: boolean;
  /** Paths confirmed against vendor documentation. */
  verified: boolean;
  /** Where global Skills live, relative to the server's home directory. */
  globalRoots: (context: Pick<PlatformScanContext, "homeDir" | "dataDir">) => string[];
  /** Where this platform reads project-scoped Skills. */
  projectRoots: (projectRoot: string) => string[];
  summary: string;
}

const MOLIBOT_PROJECT_ROOT = (projectRoot: string) => [join(projectRoot, ".agents", "skills")];

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  {
    id: "molibot",
    label: "Molibot",
    writable: true,
    verified: true,
    globalRoots: ({ dataDir }) => [join(dataDir, "skills")],
    projectRoots: MOLIBOT_PROJECT_ROOT,
    summary: "Molibot global and project Skill roots"
  },
  {
    id: "claude-code",
    label: "Claude Code",
    writable: true,
    verified: true,
    globalRoots: ({ homeDir }) => [join(homeDir, ".claude", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".claude", "skills")],
    summary: "~/.claude/skills and .claude/skills"
  },
  {
    id: "codex",
    label: "Codex",
    writable: true,
    verified: true,
    globalRoots: ({ homeDir }) => [join(homeDir, ".codex", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".codex", "skills")],
    summary: "~/.codex/skills and .codex/skills"
  },
  {
    id: "opencode",
    label: "OpenCode",
    writable: true,
    verified: true,
    // OpenCode also reads the Claude- and agents-compatible trees, which is why
    // the same physical directory can be shared by three platforms. The manager
    // reports that relationship instead of counting three installations.
    globalRoots: ({ homeDir }) => [
      join(homeDir, ".config", "opencode", "skills"),
      join(homeDir, ".claude", "skills"),
      join(homeDir, ".agents", "skills")
    ],
    projectRoots: (projectRoot) => [
      join(projectRoot, ".opencode", "skills"),
      join(projectRoot, ".claude", "skills"),
      join(projectRoot, ".agents", "skills")
    ],
    summary: "own roots plus the shared .claude and .agents trees"
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    writable: true,
    verified: false,
    globalRoots: ({ homeDir }) => [join(homeDir, ".agents", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".agents", "skills")],
    summary: "shared ~/.agents/skills tree"
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    writable: true,
    verified: true,
    globalRoots: ({ homeDir }) => [join(homeDir, ".gemini", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".gemini", "skills")],
    summary: "~/.gemini/skills and .gemini/skills"
  },
  {
    id: "cursor",
    label: "Cursor",
    writable: true,
    verified: false,
    globalRoots: ({ homeDir }) => [join(homeDir, ".cursor", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".cursor", "skills")],
    summary: "~/.cursor/skills and .cursor/skills"
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    writable: true,
    verified: false,
    globalRoots: ({ homeDir }) => [join(homeDir, ".copilot", "skills")],
    projectRoots: (projectRoot) => [join(projectRoot, ".github", "skills")],
    summary: "~/.copilot/skills and .github/skills"
  }
] as const;

export function findPlatformPreset(id: string): PlatformPreset | null {
  return PLATFORM_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Effective roots for one platform: preset roots minus anything the owner
 * removed, plus explicitly added roots. A custom platform has no preset, so its
 * `extraRoots` are the whole list.
 */
export function resolvePlatformRoots(
  platform: Pick<SkillPlatformConfigRecord, "id" | "kind" | "extraRoots" | "removedRoots" | "enabled">,
  context: PlatformScanContext
): ResolvedPlatformRoot[] {
  if (!platform.enabled) return [];
  const preset = platform.kind === "preset" ? findPlatformPreset(platform.id) : null;

  const globalCandidates = preset
    ? preset.globalRoots(context).filter((path) => !platform.removedRoots.includes(path))
    : [];
  const projectCandidates: ResolvedPlatformRoot[] = preset
    ? context.projects.flatMap((project) =>
        preset
          .projectRoots(project.rootPath)
          .filter((path) => !platform.removedRoots.includes(path))
          .map((path) => ({
            path,
            scope: "project" as const,
            ownerId: project.id,
            ownerLabel: project.name
          }))
      )
    : [];

  const globalRoots: ResolvedPlatformRoot[] = globalCandidates.map((path) => ({
    path,
    scope: "global",
    ownerId: "",
    ownerLabel: ""
  }));

  const extraRoots: ResolvedPlatformRoot[] = platform.extraRoots.map((path) => ({
    path,
    scope: "global",
    ownerId: "",
    ownerLabel: ""
  }));

  return [...globalRoots, ...projectCandidates, ...extraRoots];
}


import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { join } from "node:path";
import { isSkillBackupDirectory } from "$lib/server/agent/skills/skillBackup.js";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";

/**
 * Bounded Skill directory scanning, shared by the Runtime loader and the Skill
 * Manager.
 *
 * Both surfaces need the same three things and used to implement them
 * separately: a bounded walk that cannot stall on a huge tree, transparent
 * resolution of directory links, and one definition of a valid Skill. When they
 * drifted, a linked install was visible in one surface and invisible in the
 * other — the manager showed the Skill, the Agent could never load it.
 *
 * Entry identity is the path the caller reached, never the resolved target:
 * `~/.molibot/skills/x` stays disabled when it is a link to a directory that is
 * also enabled under a different entry.
 */

export const SKILL_FILE_NAME = "SKILL.md";

export interface SkillScanLimits {
  /** Directory levels below the root. A Skill tree is shallow by contract. */
  maxDepth: number;
  /** Skill entries emitted per root before the scan reports truncation. */
  maxEntries: number;
  /** Directories visited per root, counted across links. */
  maxDirectories: number;
  /** Wall-clock budget for one root; a slow network mount must not hang a request. */
  maxDurationMs: number;
}

export const DEFAULT_SCAN_LIMITS: SkillScanLimits = {
  maxDepth: 6,
  maxEntries: 2_000,
  maxDirectories: 4_000,
  maxDurationMs: 4_000
};

export interface ScannedSkillEntry {
  /** Path of SKILL.md as reached through the scanned entry. */
  filePath: string;
  /** Directory of SKILL.md as reached through the scanned entry. */
  entryDir: string;
  /** Fully resolved directory, used for grouping identical content. */
  realDir: string;
  /** True when the entry path differs from its resolved target. */
  linked: boolean;
}

export type SkillScanDiagnosticCode =
  | "root_unreadable"
  | "directory_unreadable"
  | "broken_link"
  | "truncated";

export interface SkillScanDiagnostic {
  code: SkillScanDiagnosticCode;
  /** Absolute path the diagnostic is about; callers render or group by it. */
  path: string;
  message: string;
}

export interface SkillScanResult {
  root: string;
  entries: ScannedSkillEntry[];
  diagnostics: SkillScanDiagnostic[];
  truncated: boolean;
}

export type SkillManifestStatus =
  | { ok: true; name: string; description: string; frontmatter: Record<string, string>; raw: string }
  | { ok: false; code: "unreadable" | "missing_frontmatter" | "missing_name" | "missing_description"; message: string };

/**
 * Directories that never contain a Skill entry and would only add noise or
 * cost: dependency trees, repository metadata, caches, interpreter venvs and
 * our own backup/staging areas.
 */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo"
]);

export function isIgnoredScanDirectory(name: string): boolean {
  if (IGNORED_DIRECTORIES.has(name)) return true;
  if (isSkillBackupDirectory(name)) return true;
  // Manager-owned staging and recovery areas. They are siblings of real Skill
  // roots, but a custom root may point at a parent directory.
  if (name.startsWith(".staging") || name.startsWith(".quarantine")) return true;
  return false;
}

function readDirectory(dir: string): { entries: Dirent[] } | { error: string } {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function statFollowingLinks(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function resolveRealPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Walk one root and emit every directory that holds a `SKILL.md`.
 *
 * The walk follows directory links but never escapes its own ancestry: the
 * chain of resolved directories is carried down each branch, so a link that
 * points back at an ancestor is skipped instead of looping forever. A broken
 * link becomes a diagnostic rather than an exception, because one bad entry in
 * a shared root must not hide the rest of the tree.
 */
export function scanSkillRoot(rootDir: string, options?: Partial<SkillScanLimits>): SkillScanResult {
  const limits: SkillScanLimits = { ...DEFAULT_SCAN_LIMITS, ...options };
  const entries: ScannedSkillEntry[] = [];
  const diagnostics: SkillScanDiagnostic[] = [];
  let truncated = false;
  let directoriesVisited = 0;
  const deadline = Date.now() + limits.maxDurationMs;

  if (!existsSync(rootDir)) {
    return { root: rootDir, entries, diagnostics, truncated };
  }

  const rootStat = statFollowingLinks(rootDir);
  if (!rootStat?.isDirectory()) {
    return {
      root: rootDir,
      entries,
      diagnostics: [{ code: "root_unreadable", path: rootDir, message: "Scan root is not a readable directory" }],
      truncated
    };
  }

  const rootReal = resolveRealPath(rootDir) ?? rootDir;

  interface PendingDirectory {
    dir: string;
    depth: number;
    /** Resolved ancestors, used to refuse cycles. */
    ancestry: Set<string>;
    /** True when this directory was reached through a link. */
    viaLink: boolean;
  }

  const queue: PendingDirectory[] = [{ dir: rootDir, depth: 0, ancestry: new Set([rootReal]), viaLink: false }];

  while (queue.length > 0) {
    const current = queue.shift() as PendingDirectory;
    if (current.depth > limits.maxDepth) continue;
    if (Date.now() > deadline) {
      truncated = true;
      diagnostics.push({
        code: "truncated",
        path: rootDir,
        message: `Stopped after the ${limits.maxDurationMs}ms scan budget`
      });
      break;
    }
    if (directoriesVisited >= limits.maxDirectories) {
      truncated = true;
      diagnostics.push({
        code: "truncated",
        path: rootDir,
        message: `Stopped after ${limits.maxDirectories} directories`
      });
      break;
    }
    directoriesVisited += 1;

    const listing = readDirectory(current.dir);
    if ("error" in listing) {
      diagnostics.push({
        code: current.depth === 0 ? "root_unreadable" : "directory_unreadable",
        path: current.dir,
        message: listing.error
      });
      continue;
    }

    const children = [...listing.entries].sort((a, b) => a.name.localeCompare(b.name));

    // A directory holding SKILL.md is one Skill entry. The walk continues into
    // it anyway: the previous loader found nested Skills, and dropping that
    // would silently hide Skills that already work today.
    const skillFile = children.find((child) => child.name.toLowerCase() === SKILL_FILE_NAME.toLowerCase());
    if (skillFile && current.depth > 0) {
      const filePath = join(current.dir, skillFile.name);
      const fileStat = statFollowingLinks(filePath);
      const realDir = resolveRealPath(current.dir);
      const realFile = fileStat?.isFile() ? resolveRealPath(filePath) : null;
      if (!fileStat || !realFile) {
        diagnostics.push({
          code: "broken_link",
          path: filePath,
          message: "SKILL.md is a broken link"
        });
      } else if (entries.length >= limits.maxEntries) {
        truncated = true;
      } else {
        entries.push({
          filePath,
          entryDir: current.dir,
          realDir: realDir ?? current.dir,
          // "Linked" means reached through a link, not merely that the volume's
          // realpath differs (macOS /var is a symlink to /private/var).
          linked: current.viaLink
        });
      }
    }

    for (const child of children) {
      const childPath = join(current.dir, child.name);

      if (child.isDirectory()) {
        if (isIgnoredScanDirectory(child.name)) continue;
        const real = resolveRealPath(childPath);
        if (!real) continue;
        if (current.ancestry.has(real)) continue;
        queue.push({
          dir: childPath,
          depth: current.depth + 1,
          ancestry: new Set([...current.ancestry, real]),
          viaLink: current.viaLink
        });
        continue;
      }

      if (child.isSymbolicLink()) {
        if (isIgnoredScanDirectory(child.name)) continue;
        const target = statFollowingLinks(childPath);
        if (!target) {
          // A link to SKILL.md is diagnosed above; everything else is a broken
          // sibling entry that should not take the scan down.
          if (child.name.toLowerCase() !== SKILL_FILE_NAME.toLowerCase()) {
            diagnostics.push({ code: "broken_link", path: childPath, message: "Broken link skipped" });
          }
          continue;
        }
        if (!target.isDirectory()) continue;
        const real = resolveRealPath(childPath);
        if (!real) continue;
        if (current.ancestry.has(real)) continue;
        queue.push({
          dir: childPath,
          depth: current.depth + 1,
          ancestry: new Set([...current.ancestry, real]),
          viaLink: true
        });
      }
    }
  }

  return { root: rootDir, entries, diagnostics, truncated };
}

export interface SkillScanRoot {
  root: string;
  scope: string;
}

export interface ScannedSkillEntryWithScope extends ScannedSkillEntry {
  scope: string;
  root: string;
}

export interface SkillTreeScanResult {
  entries: ScannedSkillEntryWithScope[];
  diagnostics: SkillScanDiagnostic[];
  truncated: boolean;
}

/** Scan several roots in declaration order, preserving each entry's scope. */
export function scanSkillRoots(
  roots: readonly SkillScanRoot[],
  options?: Partial<SkillScanLimits>
): SkillTreeScanResult {
  const entries: ScannedSkillEntryWithScope[] = [];
  const diagnostics: SkillScanDiagnostic[] = [];
  let truncated = false;
  for (const root of roots) {
    const result = scanSkillRoot(root.root, options);
    diagnostics.push(...result.diagnostics);
    truncated ||= result.truncated;
    for (const entry of result.entries) entries.push({ ...entry, scope: root.scope, root: root.root });
  }
  return { entries, diagnostics, truncated };
}

/**
 * Read and validate one entry's `SKILL.md`.
 *
 * Both surfaces agree on what "valid" means: parseable frontmatter with a
 * non-empty name and description. Format validity says a Skill can be parsed —
 * it says nothing about whether it can run.
 */
export function inspectSkillEntry(entryDir: string): SkillManifestStatus {
  let raw = "";
  try {
    raw = readFileSync(join(entryDir, SKILL_FILE_NAME), "utf8");
  } catch (cause) {
    return {
      ok: false,
      code: "unreadable",
      message: cause instanceof Error ? cause.message : String(cause)
    };
  }
  const frontmatter = parseSkillFrontmatter(raw);
  if (!frontmatter) {
    return { ok: false, code: "missing_frontmatter", message: "Missing frontmatter" };
  }
  const name = frontmatter.name?.trim() ?? "";
  const description = frontmatter.description?.trim() ?? "";
  if (!name) return { ok: false, code: "missing_name", message: "Missing skill name" };
  if (!description) return { ok: false, code: "missing_description", message: "Missing skill description" };
  return { ok: true, name, description, frontmatter, raw };
}


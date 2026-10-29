import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Skill content inspection and staged copying.
 *
 * A Skill is a directory tree, so three things must be true before Molibot
 * writes it anywhere: the tree must be bounded, every link inside it must
 * resolve *inside* it, and the receipt must describe the exact bytes
 * (including the executable bit) that were installed. Copying first and
 * inspecting later is how an installer ends up following a link out of the
 * Skill and copying an unrelated directory.
 */

export interface SkillTreeLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export const DEFAULT_TREE_LIMITS: SkillTreeLimits = {
  maxFiles: 2_000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDepth: 10
};

export type SkillTreeProblemCode =
  | "symlink_escape"
  | "symlink_loop"
  | "too_many_files"
  | "file_too_large"
  | "total_too_large"
  | "unreadable"
  | "not_a_directory";

export interface SkillTreeProblem {
  code: SkillTreeProblemCode;
  path: string;
  message: string;
}

export type SkillTreeEntry =
  | { kind: "dir"; relativePath: string }
  | { kind: "file"; relativePath: string; size: number; executable: boolean; mode: number; hash: string }
  | { kind: "symlink"; relativePath: string; targetRelativePath: string };

export interface SkillTreeInspection {
  rootDir: string;
  realRoot: string;
  entries: SkillTreeEntry[];
  problems: SkillTreeProblem[];
  hash: string;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
}

const IGNORED_TREE_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".staging"
]);

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function hashFileBytes(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function computeTreeHash(entries: readonly SkillTreeEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    if (entry.kind === "dir") {
      hash.update(`d\0${entry.relativePath}\n`);
      continue;
    }
    if (entry.kind === "symlink") {
      hash.update(`l\0${entry.relativePath}\0${entry.targetRelativePath}\n`);
      continue;
    }
    hash.update(`f\0${entry.relativePath}\0${entry.executable ? "x" : "-"}\0${entry.hash}\n`);
  }
  return hash.digest("hex");
}

/**
 * Walk a Skill directory without following links out of it.
 *
 * The returned plan doubles as the copy plan and as the content fingerprint:
 * both come from one traversal so a receipt can never describe a different
 * tree than the one that was written.
 */
export function inspectSkillTree(rootDir: string, options?: Partial<SkillTreeLimits>): SkillTreeInspection {
  const limits: SkillTreeLimits = { ...DEFAULT_TREE_LIMITS, ...options };
  const problems: SkillTreeProblem[] = [];
  const entries: SkillTreeEntry[] = [];
  let totalBytes = 0;
  let truncated = false;

  let realRoot = "";
  try {
    const stat = lstatSync(rootDir);
    if (!stat.isDirectory() && !(stat.isSymbolicLink() && lstatSync(realpathSync(rootDir)).isDirectory())) {
      return {
        rootDir,
        realRoot: rootDir,
        entries,
        problems: [{ code: "not_a_directory", path: rootDir, message: "Skill entry is not a directory" }],
        hash: "",
        fileCount: 0,
        totalBytes: 0,
        truncated: false
      };
    }
    realRoot = realpathSync(rootDir);
  } catch (cause) {
    return {
      rootDir,
      realRoot: rootDir,
      entries,
      problems: [{ code: "unreadable", path: rootDir, message: cause instanceof Error ? cause.message : String(cause) }],
      hash: "",
      fileCount: 0,
      totalBytes: 0,
      truncated: false
    };
  }

  const walk = (dir: string, relativeDir: string, ancestry: Set<string>, depth: number): void => {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      truncated = true;
      problems.push({ code: "too_many_files", path: dir, message: "Skill tree is nested too deeply" });
      return;
    }
    let children: Dirent[];
    try {
      children = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (cause) {
      problems.push({
        code: "unreadable",
        path: dir,
        message: cause instanceof Error ? cause.message : String(cause)
      });
      return;
    }

    for (const child of children) {
      if (truncated) return;
      const childPath = join(dir, child.name);
      const relativePath = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      let stat: Stats;
      try {
        stat = lstatSync(childPath);
      } catch (cause) {
        problems.push({
          code: "unreadable",
          path: childPath,
          message: cause instanceof Error ? cause.message : String(cause)
        });
        continue;
      }

      if (stat.isSymbolicLink()) {
        let realTarget: string;
        try {
          realTarget = realpathSync(childPath);
        } catch {
          problems.push({ code: "unreadable", path: childPath, message: "Link target is missing" });
          continue;
        }
        if (!isInside(realRoot, realTarget)) {
          problems.push({
            code: "symlink_escape",
            path: childPath,
            message: "Link points outside the Skill directory"
          });
          continue;
        }
        const targetRelative = toPosix(relative(realRoot, realTarget));
        const targetStat = lstatSync(realTarget);
        if (targetStat.isDirectory()) {
          if (ancestry.has(realTarget)) {
            problems.push({ code: "symlink_loop", path: childPath, message: "Link points at an ancestor" });
            continue;
          }
          entries.push({ kind: "symlink", relativePath: `${relativePath}`, targetRelativePath: targetRelative });
          walk(realTarget, relativePath, new Set([...ancestry, realTarget]), depth + 1);
          continue;
        }
        entries.push({ kind: "symlink", relativePath: relativePath, targetRelativePath: targetRelative });
        continue;
      }

      if (stat.isDirectory()) {
        if (IGNORED_TREE_DIRECTORIES.has(child.name)) continue;
        entries.push({ kind: "dir", relativePath });
        walk(childPath, relativePath, ancestry, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;

      if (stat.size > limits.maxFileBytes) {
        problems.push({
          code: "file_too_large",
          path: childPath,
          message: `File exceeds ${limits.maxFileBytes} bytes`
        });
        continue;
      }
      if (totalBytes + stat.size > limits.maxTotalBytes) {
        truncated = true;
        problems.push({
          code: "total_too_large",
          path: childPath,
          message: `Skill exceeds ${limits.maxTotalBytes} bytes`
        });
        return;
      }
      totalBytes += stat.size;
      if (entries.filter((entry) => entry.kind !== "dir").length >= limits.maxFiles) {
        truncated = true;
        problems.push({ code: "too_many_files", path: childPath, message: "Skill contains too many files" });
        return;
      }
      entries.push({
        kind: "file",
        relativePath,
        size: stat.size,
        executable: (stat.mode & 0o111) !== 0,
        mode: stat.mode & 0o777,
        hash: hashFileBytes(childPath)
      });
    }
  };

  walk(realRoot, "", new Set([realRoot]), 0);

  return {
    rootDir,
    realRoot,
    entries,
    problems,
    hash: computeTreeHash(entries),
    fileCount: entries.filter((entry) => entry.kind !== "dir").length,
    totalBytes,
    truncated
  };
}

export interface CopySkillTreeInput {
  sourceDir: string;
  targetDir: string;
  inspection: SkillTreeInspection;
  /** Rewrite the frontmatter name to the new directory name. */
  renameTo?: string;
}

/**
 * Materialise an inspected tree at `targetDir` (which must not exist).
 *
 * Files are written through a staging directory by the caller; this function
 * never deletes anything, so a partial copy leaves the previous installation
 * untouched.
 */
export function copySkillTree(input: CopySkillTreeInput): void {
  const { sourceDir, targetDir, inspection } = input;
  mkdirSync(targetDir, { recursive: true });

  for (const entry of inspection.entries) {
    const targetPath = join(targetDir, ...entry.relativePath.split("/"));
    if (entry.kind === "dir") {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    if (entry.kind === "symlink") {
      // Recreate the link relative to its new location so the copy stays inside
      // its own tree even when the source used an absolute path.
      const linkDirectory = dirname(targetPath);
      const resolvedTarget = join(targetDir, ...entry.targetRelativePath.split("/"));
      const linkTarget = relative(linkDirectory, resolvedTarget);
      try {
        unlinkSync(targetPath);
      } catch {
        // Nothing to unlink: the target is a fresh staging directory.
      }
      symlinkSync(linkTarget, targetPath);
      continue;
    }
    const sourcePath = join(sourceDir, ...entry.relativePath.split("/"));
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, entry.executable ? entry.mode | 0o100 : entry.mode);
  }

  if (input.renameTo) {
    renameSkillFrontmatter(join(targetDir, "SKILL.md"), input.renameTo);
  }
}

/**
 * Rename a Skill: the directory name and the frontmatter name must agree, or
 * the target tool refuses to load it. Only the `name:` line inside the
 * frontmatter block is rewritten; the body and every other field stay byte
 * identical.
 */
export function renameSkillFrontmatter(skillFilePath: string, name: string): void {
  let raw = "";
  try {
    raw = readFileSync(skillFilePath, "utf8");
  } catch {
    return;
  }
  const block = raw.match(/^(---\s*\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
  if (!block) return;
  const body = block[2];
  const rewritten = /^name\s*:.*$/m.test(body)
    ? body.replace(/^name\s*:.*$/m, `name: ${name}`)
    : `name: ${name}\n${body}`;
  if (rewritten === body) return;
  writeFileSync(skillFilePath, `${block[1]}${rewritten}${block[3]}${raw.slice(block[0].length)}`, "utf8");
}

/** Resolve a candidate target path and refuse anything outside its intended root. */
export function assertInsideRoot(rootDir: string, candidate: string): string {
  const root = resolve(rootDir);
  const target = resolve(candidate);
  if (!isInside(root, target)) throw new Error("Target path escapes its Skill root");
  if (target === root) throw new Error("Target path must be inside the Skill root");
  return target;
}

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}

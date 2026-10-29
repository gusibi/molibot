import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync
} from "node:fs";
import type { Dirent } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Bounded, contained reads inside one Skill directory.
 *
 * Both functions resolve the requested path and then re-check the *resolved*
 * target: a link planted inside a Skill cannot be used to read the rest of the
 * disk, and a preview never streams an unbounded file into the UI.
 */

/** Preview cap for one Skill file. Larger text is truncated, never streamed whole. */
export const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_DIR_ENTRIES = 1000;
const MAX_DIR_DEPTH = 8;

export interface SkillFileEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
}

/** Recursively list a Skill directory, relative POSIX paths, directories first. */
export function listSkillDirectory(baseDir: string): SkillFileEntry[] {
  const entries: SkillFileEntry[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > MAX_DIR_DEPTH || entries.length >= MAX_DIR_ENTRIES) return;
    let children: Dirent[];
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= MAX_DIR_ENTRIES) return;
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      // Dirent reports a link as neither file nor directory, so resolve it. A
      // link is part of the Skill's visible structure; containment is enforced
      // by the preview read, not by hiding the entry.
      let stat;
      try {
        stat = child.isSymbolicLink() ? statSync(join(dir, child.name)) : null;
      } catch {
        continue;
      }
      const isDirectory = stat ? stat.isDirectory() : child.isDirectory();
      const isFile = stat ? stat.isFile() : child.isFile();
      if (isDirectory) {
        entries.push({ path: relativePath, kind: "dir", size: 0 });
        walk(join(dir, child.name), relativePath, depth + 1);
        continue;
      }
      if (!isFile) continue;
      try {
        entries.push({ path: relativePath, kind: "file", size: statSync(join(dir, child.name)).size });
      } catch {
        entries.push({ path: relativePath, kind: "file", size: 0 });
      }
    }
  };
  walk(baseDir, "", 0);
  return entries.sort((a, b) => {
    if ((a.kind === "dir") !== (b.kind === "dir")) return a.kind === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

/**
 * Read one text file from a Skill directory. The path is resolved inside the
 * Skill directory and re-checked after symlink expansion, so a link planted in
 * a Skill cannot read the rest of the disk.
 */
export function readSkillFileContent(
  baseDir: string,
  relativePath: string
): { content: string; truncated: boolean; binary: boolean } {
  const root = realpathSync(baseDir);
  let real: string;
  try {
    real = realpathSync(resolve(root, relativePath));
  } catch {
    throw new Error("File not found");
  }
  if (real !== root && !real.startsWith(root + sep)) throw new Error("Path escapes the Skill directory");
  const descriptor = openSync(real, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("Not a file");
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_PREVIEW_BYTES));
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    const slice = buffer.subarray(0, length);
    const binary = slice.includes(0);
    return { content: binary ? "" : slice.toString("utf8"), truncated: stat.size > MAX_PREVIEW_BYTES, binary };
  } finally {
    closeSync(descriptor);
  }
}

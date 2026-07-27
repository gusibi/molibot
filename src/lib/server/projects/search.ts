import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { Ignore } from "ignore";
import { loadGitignore, looksBinary, relativePath } from "./inspection.js";
import type { ProjectRecord } from "./store.js";

const MAX_SCANNED_FILES = 20_000;
const MAX_DEPTH = 16;
const WALK_BUDGET_MS = 5_000;
const MAX_NAME_HITS = 100;
const MAX_CONTENT_FILES = 60;
const MAX_LINES_PER_FILE = 20;
const MAX_CONTENT_FILE_BYTES = 512 * 1024;
const MAX_LINE_CHARS = 400;

/**
 * Directories that are build output or tool caches in every ecosystem we
 * support. A Project without a `.gitignore` would otherwise make the walker
 * spend its whole budget inside `node_modules`.
 */
export const ALWAYS_SKIP_DIRECTORIES = new Set([
  ".git", ".hg", ".svn",
  "node_modules", ".pnpm-store", ".yarn",
  ".svelte-kit", ".next", ".nuxt", ".turbo", ".parcel-cache", ".vite",
  "__pycache__", ".venv", ".mypy_cache", ".pytest_cache", ".ruff_cache",
  ".gradle", ".idea", "DerivedData", "Pods",
  ".cache", ".terraform"
]);

export interface ProjectSearchNameHit {
  path: string;
  name: string;
  sizeBytes: number;
  score: number;
}

export interface ProjectSearchContentLine {
  line: number;
  text: string;
  /** Byte-independent character offsets of the first match inside `text`. */
  start: number;
  end: number;
}

export interface ProjectSearchContentHit {
  path: string;
  name: string;
  lines: ProjectSearchContentLine[];
  truncated: boolean;
}

export type ProjectSearchResult =
  | { mode: "name"; query: string; hits: ProjectSearchNameHit[]; scanned: number; truncated: boolean }
  | { mode: "content"; query: string; hits: ProjectSearchContentHit[]; scanned: number; truncated: boolean };

export interface ProjectSearchInput {
  query: string;
  mode?: "name" | "content";
  limit?: number;
  caseSensitive?: boolean;
}

interface IgnoreFrame {
  /** Directory the ignore rules are anchored to, relative to the Project root. */
  base: string;
  matcher: Ignore;
}

function isIgnored(frames: IgnoreFrame[], relPath: string, isDirectory: boolean): boolean {
  for (const frame of frames) {
    const scoped = frame.base ? relPath.slice(frame.base.length + 1) : relPath;
    if (!scoped) continue;
    if (frame.matcher.ignores(isDirectory ? `${scoped}/` : scoped)) return true;
  }
  return false;
}

/**
 * Subsequence scorer in the spirit of an editor's "go to file" palette. Returns
 * `null` when the query is not a subsequence of the candidate. Higher is better.
 *
 * Scoring is character-based rather than word-based on purpose: whitespace
 * tokenization collapses CJK paths into a single token, so a Chinese directory
 * name would otherwise never rank.
 */
export function fuzzyScore(candidate: string, query: string): number | null {
  if (!query) return 0;
  const haystack = candidate.toLowerCase();
  const needle = query.toLowerCase();
  const basenameStart = haystack.lastIndexOf("/") + 1;

  let score = 0;
  let cursor = 0;
  let previousIndex = -1;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return null;
    score += 1;
    if (index === previousIndex + 1) score += 8;
    const previousChar = index > 0 ? haystack[index - 1] : "/";
    if (previousChar === "/" || previousChar === "-" || previousChar === "_" || previousChar === ".") score += 6;
    if (index >= basenameStart) score += 4;
    previousIndex = index;
    cursor = index + 1;
  }
  // Prefer shallow, short paths when two candidates match equally well.
  score -= Math.min(20, haystack.length - needle.length) * 0.1;
  score -= (haystack.split("/").length - 1) * 0.5;
  return score;
}

function matchLine(line: string, needle: string, caseSensitive: boolean): number {
  return caseSensitive ? line.indexOf(needle) : line.toLowerCase().indexOf(needle.toLowerCase());
}

function clipLine(text: string, start: number, end: number): { text: string; start: number; end: number } {
  if (text.length <= MAX_LINE_CHARS) return { text, start, end };
  const windowStart = Math.max(0, Math.min(start - 60, text.length - MAX_LINE_CHARS));
  return {
    text: text.slice(windowStart, windowStart + MAX_LINE_CHARS),
    start: start - windowStart,
    end: Math.min(end - windowStart, MAX_LINE_CHARS)
  };
}

interface WalkState {
  root: string;
  deadline: number;
  scanned: number;
  truncated: boolean;
}

async function walk(
  state: WalkState,
  directory: string,
  frames: IgnoreFrame[],
  depth: number,
  onFile: (relPath: string, name: string, sizeBytes: number) => boolean | Promise<boolean>
): Promise<void> {
  if (depth > MAX_DEPTH || state.truncated) {
    state.truncated = state.truncated || depth > MAX_DEPTH;
    return;
  }
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const nested = await loadGitignore(directory);
  const scopedFrames = nested
    ? [...frames, { base: relativePath(state.root, directory), matcher: nested }]
    : frames;

  for (const entry of dirents) {
    if (state.truncated) return;
    if (Date.now() > state.deadline || state.scanned >= MAX_SCANNED_FILES) {
      state.truncated = true;
      return;
    }
    const absolute = path.join(directory, entry.name);
    const rel = relativePath(state.root, absolute);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP_DIRECTORIES.has(entry.name)) continue;
      if (isIgnored(scopedFrames, rel, true)) continue;
      await walk(state, absolute, scopedFrames, depth + 1, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isIgnored(scopedFrames, rel, false)) continue;
    state.scanned += 1;
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(absolute)).size;
    } catch {
      continue;
    }
    const keepGoing = await onFile(rel, entry.name, sizeBytes);
    if (!keepGoing) {
      state.truncated = true;
      return;
    }
  }
}

async function readTextFile(absolute: string, sizeBytes: number): Promise<string | null> {
  if (sizeBytes > MAX_CONTENT_FILE_BYTES) return null;
  let handle;
  try {
    handle = await fs.open(absolute, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(sizeBytes);
    const { bytesRead } = await handle.read(buffer, 0, sizeBytes, 0);
    const content = buffer.subarray(0, bytesRead);
    if (looksBinary(content)) return null;
    return content.toString("utf8");
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Walks the Project tree once and returns either fuzzy filename matches or
 * literal content matches. Every traversal is bounded by file count, depth and
 * a wall-clock budget: the Project root is an arbitrary directory the user
 * pointed us at, so an unbounded recursive scan is not an option.
 */
export async function searchProject(project: ProjectRecord, input: ProjectSearchInput): Promise<ProjectSearchResult> {
  const query = String(input.query ?? "").trim();
  const mode = input.mode === "content" ? "content" : "name";
  if (!query) return { mode, query, hits: [], scanned: 0, truncated: false };

  const root = await fs.realpath(project.rootPath);
  const rootIgnore = await loadGitignore(root);
  const frames: IgnoreFrame[] = rootIgnore ? [{ base: "", matcher: rootIgnore }] : [];
  const state: WalkState = { root, deadline: Date.now() + WALK_BUDGET_MS, scanned: 0, truncated: false };

  if (mode === "name") {
    const limit = Math.max(1, Math.min(MAX_NAME_HITS, Math.floor(input.limit ?? 40)));
    const hits: ProjectSearchNameHit[] = [];
    await walk(state, root, frames, 0, (relPath, name, sizeBytes) => {
      const score = fuzzyScore(relPath, query);
      if (score !== null) hits.push({ path: relPath, name, sizeBytes, score });
      return true;
    });
    hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return {
      mode,
      query,
      hits: hits.slice(0, limit),
      scanned: state.scanned,
      truncated: state.truncated || hits.length > limit
    };
  }

  const limit = Math.max(1, Math.min(MAX_CONTENT_FILES, Math.floor(input.limit ?? 40)));
  const caseSensitive = Boolean(input.caseSensitive);
  const hits: ProjectSearchContentHit[] = [];
  await walk(state, root, frames, 0, async (relPath, name, sizeBytes) => {
    const content = await readTextFile(path.join(root, relPath), sizeBytes);
    if (content === null) return true;
    const lines: ProjectSearchContentLine[] = [];
    let fileTruncated = false;
    const rawLines = content.split("\n");
    for (let index = 0; index < rawLines.length; index += 1) {
      const raw = rawLines[index].replace(/\r$/, "");
      const at = matchLine(raw, query, caseSensitive);
      if (at < 0) continue;
      if (lines.length >= MAX_LINES_PER_FILE) {
        fileTruncated = true;
        break;
      }
      const clipped = clipLine(raw, at, at + query.length);
      lines.push({ line: index + 1, text: clipped.text, start: clipped.start, end: clipped.end });
    }
    if (lines.length) hits.push({ path: relPath, name, lines, truncated: fileTruncated });
    return hits.length < limit;
  });

  return { mode, query, hits, scanned: state.scanned, truncated: state.truncated };
}

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { ProjectRecord } from "./store.js";

const DEFAULT_TREE_LIMIT = 200;
const MAX_TREE_LIMIT = 500;
/** Bytes returned by a single preview request; the viewer pages through a file with `offset`. */
export const PREVIEW_WINDOW_BYTES = 512 * 1024;
/** Above this a file is reported as oversized instead of being paged as text. */
export const MAX_TEXT_PREVIEW_BYTES = 16 * 1024 * 1024;
const ENCODING_SAMPLE_BYTES = 8_192;
const MAX_GIT_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 8_000;

export interface ProjectTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  sizeBytes?: number;
}

export interface TreePage {
  path: string;
  entries: ProjectTreeEntry[];
  truncated: boolean;
  nextCursor?: string;
}

export type FilePreviewResult =
  | {
      status: "text";
      path: string;
      content: string;
      sizeBytes: number;
      /** First byte this window decoded; the viewer passes it back to page forward. */
      byteOffset: number;
      /** Bytes consumed by `content`, so `byteOffset + byteLength` is the next offset. */
      byteLength: number;
      truncated: boolean;
    }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number };

export interface FilePreviewInput {
  path: string;
  /** Byte position to start decoding at; clamped into the file and onto a character boundary. */
  offset?: number;
  maxBytes?: number;
}

export interface GitStatusEntry {
  path: string;
  previousPath?: string;
  previousOutsideProject?: boolean;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
}

export type GitStatusResult =
  | { status: "ok"; entries: GitStatusEntry[]; truncated: boolean }
  | { status: "unavailable"; reason: string };

export type GitDiffResult =
  | { status: "diff"; path: string; content: string; truncated: boolean }
  | { status: "untracked"; path: string; preview: FilePreviewResult }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number }
  | { status: "unavailable"; reason: string };

export function relativePath(root: string, candidate: string): string {
  return path.relative(root, candidate).replaceAll("\\", "/");
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Loads the `.gitignore` that lives directly inside `directory`, if any. The
 * tree listing only consults the Project root; the search walker composes one
 * of these per directory it descends into so nested ignore files apply too.
 */
export async function loadGitignore(directory: string): Promise<Ignore | null> {
  try {
    const content = await fs.readFile(path.join(directory, ".gitignore"), "utf8");
    return ignore().add(content);
  } catch {
    return null;
  }
}

async function loadRootGitignore(root: string): Promise<Ignore | null> {
  return await loadGitignore(root);
}

export async function resolveProjectPath(project: Pick<ProjectRecord, "rootPath">, input = "", allowSymlink = false, requireExists = true): Promise<{ root: string; target: string; relative: string }> {
  const root = await fs.realpath(project.rootPath);
  const requested = String(input ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const target = path.resolve(root, requested);
  if (!isInside(root, target)) throw new Error("Path is outside the Project root.");
  if (!requireExists) return { root, target, relative: relativePath(root, target) };
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) {
    if (!allowSymlink) throw new Error("Symbolic links cannot be opened.");
  } else {
    const realTarget = await fs.realpath(target);
    if (!isInside(root, realTarget)) throw new Error("Path resolves outside the Project root.");
  }
  return { root, target, relative: relativePath(root, target) };
}

export type TextEncodingGuess = "utf8" | "utf16le" | "utf16be" | "binary";

function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function utf16BomOf(buffer: Buffer): "utf16le" | "utf16be" | null {
  if (buffer.length < 2) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf16le";
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf16be";
  return null;
}

/**
 * BOM-less UTF-16 text is mostly ASCII, so one byte of every pair is NUL and
 * always on the same side. That pattern is what separates it from real binary,
 * which scatters NUL bytes across both positions.
 */
function utf16WithoutBom(sample: Buffer): "utf16le" | "utf16be" | null {
  const pairBytes = sample.length - (sample.length % 2);
  if (pairBytes < 16) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let index = 0; index < pairBytes; index += 2) {
    if (sample[index] === 0) evenNul += 1;
    if (sample[index + 1] === 0) oddNul += 1;
  }
  const pairs = pairBytes / 2;
  if (oddNul / pairs > 0.6 && evenNul / pairs < 0.1) return "utf16le";
  if (evenNul / pairs > 0.6 && oddNul / pairs < 0.1) return "utf16be";
  return null;
}

/** Control characters outside tab/newline/carriage-return dominate binary payloads, not text. */
function looksControlHeavy(sample: Buffer): boolean {
  if (!sample.length) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) control += 1;
  }
  return control / sample.length > 0.3;
}

/**
 * Classifies a file's leading bytes. A bare NUL no longer means "binary" on its
 * own — UTF-16 files are full of them — so BOMs and the NUL-position pattern are
 * checked first.
 */
export function detectTextEncoding(buffer: Buffer): TextEncodingGuess {
  const sample = buffer.subarray(0, Math.min(buffer.length, ENCODING_SAMPLE_BYTES));
  if (!sample.length) return "utf8";
  if (hasUtf8Bom(sample)) return "utf8";
  const bom = utf16BomOf(sample);
  if (bom) return bom;
  const guessed = utf16WithoutBom(sample);
  if (guessed) return guessed;
  if (sample.includes(0)) return "binary";
  return looksControlHeavy(sample) ? "binary" : "utf8";
}

export function looksBinary(buffer: Buffer): boolean {
  return detectTextEncoding(buffer) === "binary";
}

/**
 * Narrows a byte window to whole UTF-8 characters. Without this a window that
 * starts or ends mid-sequence turns the first and last CJK character into
 * replacement glyphs — visible as `` at every page boundary.
 */
function utf8WindowBounds(buffer: Buffer, atStart: boolean, atEnd: boolean): { start: number; end: number } {
  let start = 0;
  if (!atStart) {
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  }
  let end = buffer.length;
  if (!atEnd) {
    let scan = end - 1;
    let trailing = 0;
    while (scan >= start && (buffer[scan] & 0xc0) === 0x80 && trailing < 3) {
      scan -= 1;
      trailing += 1;
    }
    if (scan >= start) {
      const lead = buffer[scan];
      const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
      if (needed > 1 && trailing + 1 < needed) end = scan;
    }
  }
  return { start, end: Math.max(start, end) };
}

async function runGit(projectRoot: string, args: string[]): Promise<{ ok: true; stdout: Buffer; truncated: boolean } | { ok: false; reason: string }> {
  const baseArgs = [
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=",
    "-c", "submodule.recurse=false",
    // `core.quotePath` defaults to TRUE, and this runner deliberately drops HOME
    // and system config for hermetic inspection — so a user's global
    // `quotepath=false` never reaches it. Without this, `git diff` renders every
    // non-ASCII path as backslash-octal ("02-\345\206\205…") in its `diff --git`
    // and `---`/`+++` headers, which is what the viewer shows as the file name.
    // `status --porcelain -z` is immune (NUL-delimited raw bytes), which is why
    // the changes list looked fine while the diff header did not.
    "-c", "core.quotePath=false",
    "-C", projectRoot,
    ...args
  ];
  return await new Promise((resolve) => {
    const child = spawn("git", baseArgs, {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_PAGER: "cat",
        PAGER: "cat",
        HOME: "",
        XDG_CONFIG_HOME: ""
      }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { child.kill("SIGKILL"); }
    };
    const finish = (value: { ok: true; stdout: Buffer; truncated: boolean } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      stop();
      finish({ ok: false, reason: "Git inspection timed out." });
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = MAX_GIT_BYTES - stdoutBytes;
      if (remaining > 0) stdout.push(chunk.subarray(0, remaining));
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_BYTES) {
        stop();
        finish({ ok: true, stdout: Buffer.concat(stdout), truncated: true });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on("error", () => finish({ ok: false, reason: "Git is unavailable." }));
    child.on("close", (code) => {
      if (code === 0) finish({ ok: true, stdout: Buffer.concat(stdout), truncated: false });
      else finish({ ok: false, reason: Buffer.concat(stderr).toString("utf8").trim() || "This directory is not a Git repository." });
    });
  });
}

function treeSortKey(entry: { name: string; isDirectory(): boolean }): string {
  return `${entry.isDirectory() ? "0" : "1"}:${entry.name}`;
}

function decodeTreeCursor(cursor: string | undefined): string {
  if (!cursor) return "";
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^[01]:/.test(decoded)) throw new Error();
    return decoded;
  } catch { throw new Error("Invalid tree cursor."); }
}

export async function listProjectTree(project: ProjectRecord, input: { path?: string; limit?: number; cursor?: string } = {}): Promise<TreePage> {
  const resolved = await resolveProjectPath(project, input.path ?? "");
  const stat = await fs.stat(resolved.target);
  if (!stat.isDirectory()) throw new Error("Tree path is not a directory.");
  const limit = Math.max(1, Math.min(MAX_TREE_LIMIT, Math.floor(input.limit ?? DEFAULT_TREE_LIMIT)));
  const dirents = await fs.readdir(resolved.target, { withFileTypes: true });
  dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const gitignore = await loadRootGitignore(resolved.root);
  const visible = dirents.filter((entry) => {
    if (resolved.relative === "" && entry.name === ".git") return false;
    if (gitignore) {
      const rel = relativePath(resolved.root, path.join(resolved.target, entry.name));
      return entry.isDirectory() ? !gitignore.ignores(`${rel}/`) : !gitignore.ignores(rel);
    }
    return true;
  });
  const cursorKey = decodeTreeCursor(input.cursor);
  const start = cursorKey ? visible.findIndex((entry) => {
    const entryGroup = entry.isDirectory() ? "0" : "1";
    const cursorGroup = cursorKey[0];
    return entryGroup === cursorGroup
      ? entry.name.localeCompare(cursorKey.slice(2)) > 0
      : entryGroup > cursorGroup;
  }) : 0;
  const pageStart = start < 0 ? visible.length : start;
  const pageEntries = visible.slice(pageStart, pageStart + limit);
  const entries: ProjectTreeEntry[] = [];
  for (const entry of pageEntries) {
    const entryPath = path.join(resolved.target, entry.name);
    const entryStat = await fs.lstat(entryPath);
    entries.push({
      name: entry.name,
      path: relativePath(resolved.root, entryPath),
      kind: entryStat.isSymbolicLink() ? "symlink" : entryStat.isDirectory() ? "directory" : "file",
      sizeBytes: entryStat.isFile() ? entryStat.size : undefined
    });
  }
  const truncated = pageStart + pageEntries.length < visible.length;
  return {
    path: resolved.relative,
    entries,
    truncated,
    nextCursor: truncated && pageEntries.length
      ? Buffer.from(treeSortKey(pageEntries[pageEntries.length - 1]), "utf8").toString("base64url")
      : undefined
  };
}

export async function getProjectFilePath(project: ProjectRecord, filePath: string): Promise<string> {
  const resolved = await resolveProjectPath(project, filePath, false, true);
  return resolved.target;
}

/**
 * Reads one window of a file as text. Files larger than the window are no longer
 * refused outright: the caller pages through them by passing the previous
 * response's `byteOffset + byteLength` back as `offset`. Only files past
 * `MAX_TEXT_PREVIEW_BYTES` report `oversized`, and binary ones still report
 * `binary` so the viewer can fall back to streaming the raw bytes.
 */
export async function readProjectFile(project: ProjectRecord, input: FilePreviewInput): Promise<FilePreviewResult> {
  const resolved = await resolveProjectPath(project, input.path);
  const stat = await fs.stat(resolved.target);
  if (!stat.isFile()) throw new Error("Preview path is not a file.");
  if (stat.size > MAX_TEXT_PREVIEW_BYTES) return { status: "oversized", path: resolved.relative, sizeBytes: stat.size };
  const windowBytes = Math.max(1, Math.min(PREVIEW_WINDOW_BYTES, Math.floor(input.maxBytes ?? PREVIEW_WINDOW_BYTES)));
  const requestedOffset = Math.max(0, Math.min(stat.size, Math.floor(input.offset ?? 0)));

  const handle = await fs.open(resolved.target, "r");
  try {
    // Classify from the head every time so a paged read of a binary file cannot
    // be mistaken for text just because its middle happens to be printable.
    const head = Buffer.alloc(Math.min(stat.size, ENCODING_SAMPLE_BYTES));
    if (head.length) await handle.read(head, 0, head.length, 0);
    const encoding = detectTextEncoding(head);
    if (encoding === "binary") return { status: "binary", path: resolved.relative, sizeBytes: stat.size };

    const bomBytes = encoding === "utf8" ? (hasUtf8Bom(head) ? 3 : 0) : (utf16BomOf(head) ? 2 : 0);
    let start = Math.max(bomBytes, requestedOffset);
    // UTF-16 code units are two bytes wide; an odd offset would swap every byte pair.
    if (encoding !== "utf8" && (start - bomBytes) % 2 === 1) start += 1;
    start = Math.min(start, stat.size);

    const buffer = Buffer.alloc(Math.min(windowBytes, Math.max(0, stat.size - start)));
    const bytesRead = buffer.length ? (await handle.read(buffer, 0, buffer.length, start)).bytesRead : 0;
    const chunk = buffer.subarray(0, bytesRead);
    const atEnd = start + bytesRead >= stat.size;

    let content: string;
    let byteLength: number;
    if (encoding === "utf8") {
      const bounds = utf8WindowBounds(chunk, start === bomBytes, atEnd);
      content = chunk.subarray(bounds.start, bounds.end).toString("utf8");
      byteLength = bounds.end;
    } else {
      const evenBytes = bytesRead - (bytesRead % 2);
      const units = encoding === "utf16be"
        ? Buffer.from(chunk.subarray(0, evenBytes)).swap16()
        : chunk.subarray(0, evenBytes);
      content = units.toString("utf16le");
      byteLength = evenBytes;
    }

    return {
      status: "text",
      path: resolved.relative,
      content,
      sizeBytes: stat.size,
      byteOffset: start,
      byteLength,
      truncated: start + byteLength < stat.size
    };
  } finally { await handle.close(); }
}

export async function getProjectGitStatus(project: ProjectRecord): Promise<GitStatusResult> {
  const root = await fs.realpath(project.rootPath);
  const prefixResult = await runGit(root, ["rev-parse", "--show-prefix"]);
  if (!prefixResult.ok) return { status: "unavailable", reason: prefixResult.reason };
  const projectPrefix = prefixResult.stdout.toString("utf8").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizeStatusPath = (gitPath: string): string | undefined => {
    const normalized = gitPath.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!projectPrefix) return normalized;
    return normalized.startsWith(projectPrefix) ? normalized.slice(projectPrefix.length) : undefined;
  };
  const result = await runGit(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."]);
  if (!result.ok) return { status: "unavailable", reason: result.reason };
  const fields = result.stdout.toString("utf8").split("\0");
  if (result.truncated) fields.pop();
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record || record.startsWith("# ")) continue;
    if (record.startsWith("? ")) {
      const entryPath = normalizeStatusPath(record.slice(2));
      if (entryPath) entries.push({ path: entryPath, indexStatus: "?", worktreeStatus: "?", untracked: true });
      continue;
    }
    const parts = record.split(" ");
    const pathIndex = record.startsWith("2 ") ? 9 : 8;
    if (parts.length <= pathIndex) continue;
    const xy = parts[1];
    const entryPath = normalizeStatusPath(parts.slice(pathIndex).join(" "));
    if (!entryPath) continue;
    const entry: GitStatusEntry = { path: entryPath, indexStatus: xy[0], worktreeStatus: xy[1], untracked: false };
    if (record.startsWith("2 ")) {
      const previous = fields[++index] || "";
      entry.previousPath = normalizeStatusPath(previous);
      entry.previousOutsideProject = Boolean(previous && !entry.previousPath);
    }
    entries.push(entry);
  }
  return { status: "ok", entries, truncated: result.truncated };
}

export async function getProjectGitDiff(project: ProjectRecord, input: { path: string }): Promise<GitDiffResult> {
  const resolved = await resolveProjectPath(project, input.path, false, false);
  const status = await getProjectGitStatus(project);
  if (status.status !== "ok") return status;
  const item = status.entries.find((entry) => entry.path === resolved.relative);
  if (item?.untracked) return { status: "untracked", path: resolved.relative, preview: await readProjectFile(project, { path: resolved.relative }) };
  try {
    const preview = await readProjectFile(project, { path: resolved.relative });
    if (preview.status === "binary" || preview.status === "oversized") return preview;
  } catch {
    // Deleted files do not exist in the working tree; Git remains authoritative.
  }
  const result = await runGit(resolved.root, ["diff", "HEAD", "--no-ext-diff", "--no-textconv", "--no-color", "--", resolved.relative]);
  if (!result.ok) {
    const head = await runGit(resolved.root, ["rev-parse", "--verify", "HEAD"]);
    if (!head.ok) return { status: "untracked", path: resolved.relative, preview: await readProjectFile(project, { path: resolved.relative }) };
    return { status: "unavailable", reason: result.reason };
  }
  return { status: "diff", path: resolved.relative, content: result.stdout.toString("utf8"), truncated: result.truncated };
}

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { ProjectRecord } from "./store.js";

const DEFAULT_TREE_LIMIT = 200;
const MAX_TREE_LIMIT = 500;
const MAX_PREVIEW_BYTES = 256 * 1024;
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
  | { status: "text"; path: string; content: string; sizeBytes: number; truncated: boolean }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number };

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

function relativePath(root: string, candidate: string): string {
  return path.relative(root, candidate).replaceAll("\\", "/");
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function loadRootGitignore(root: string): Promise<Ignore | null> {
  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return ignore().add(content);
  } catch {
    return null;
  }
}

async function resolveProjectPath(project: ProjectRecord, input = "", allowSymlink = false, requireExists = true): Promise<{ root: string; target: string; relative: string }> {
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

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return sample.includes(0);
}

async function runGit(projectRoot: string, args: string[]): Promise<{ ok: true; stdout: Buffer; truncated: boolean } | { ok: false; reason: string }> {
  const baseArgs = [
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=",
    "-c", "submodule.recurse=false",
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

export async function readProjectFile(project: ProjectRecord, input: { path: string; maxBytes?: number }): Promise<FilePreviewResult> {
  const resolved = await resolveProjectPath(project, input.path);
  const stat = await fs.stat(resolved.target);
  if (!stat.isFile()) throw new Error("Preview path is not a file.");
  const maxBytes = Math.max(1, Math.min(MAX_PREVIEW_BYTES, input.maxBytes ?? MAX_PREVIEW_BYTES));
  if (stat.size > MAX_PREVIEW_BYTES) return { status: "oversized", path: resolved.relative, sizeBytes: stat.size };
  const handle = await fs.open(resolved.target, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead);
    if (looksBinary(content)) return { status: "binary", path: resolved.relative, sizeBytes: stat.size };
    return { status: "text", path: resolved.relative, content: content.toString("utf8"), sizeBytes: stat.size, truncated: bytesRead < stat.size };
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

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Read one Skill subdirectory out of a Git repository without checking it out.
 *
 * `git checkout` and `git archive` both apply repository configuration — filters,
 * export-subst, and (for checkout) hooks — which means installing a third-party
 * Skill could execute code before the owner ever used it. `ls-tree` plus
 * `cat-file` reads exactly the committed blobs under the requested subdirectory,
 * so nothing in the repository runs and submodules are never fetched.
 */

export interface GitSkillFile {
  /** Path relative to the Skill subdirectory, POSIX separators. */
  path: string;
  /** Git file mode; 100755 marks an executable blob. */
  mode: number;
  content: Buffer;
}

export interface GitSkillSnapshot {
  commit: string;
  files: GitSkillFile[];
  totalBytes: number;
}

export interface GitSkillRequest {
  repository: string;
  /** Branch, tag, or commit. Defaults to HEAD; always resolves to a commit. */
  ref?: string;
  /** Repository-relative Skill directory; must not escape the repository. */
  subdirectory: string;
  maxFiles?: number;
  maxTotalBytes?: number;
}

const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function git(repository: string, args: readonly string[], maxBuffer = 32 * 1024 * 1024): Buffer {
  return execFileSync("git", ["-C", repository, "-c", "core.hooksPath=/dev/null", ...args], {
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function normalizeSubdirectory(input: string): string {
  const trimmed = input.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === ".." || segment === "" || segment === ".")) {
    throw new Error("Skill subdirectory must stay inside the repository");
  }
  return segments.join("/");
}

export function readGitSkill(request: GitSkillRequest): GitSkillSnapshot {
  const repository = resolve(request.repository);
  const subdirectory = normalizeSubdirectory(request.subdirectory);
  if (!subdirectory) throw new Error("A Skill subdirectory is required");

  const commit = git(repository, ["rev-parse", `${request.ref?.trim() || "HEAD"}^{commit}`]).toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Could not resolve the Git ref to a commit");

  const listing = git(repository, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", subdirectory]);
  const entries: Array<{ mode: number; object: string; path: string }> = [];
  for (const record of listing.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    const [rawMode, type, object] = meta;
    if (type !== "blob" || !object) continue;
    if (!path.startsWith(`${subdirectory}/`)) continue;
    entries.push({ mode: Number.parseInt(rawMode, 8) || 0o100644, object, path });
  }

  if (entries.length === 0) throw new Error("No files found in the requested Skill subdirectory");
  if (entries.length > (request.maxFiles ?? MAX_FILES)) throw new Error("Skill subdirectory contains too many files");

  let totalBytes = 0;
  const files: GitSkillFile[] = [];
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    const content = git(repository, ["cat-file", "blob", entry.object], 16 * 1024 * 1024);
    totalBytes += content.byteLength;
    if (totalBytes > (request.maxTotalBytes ?? MAX_TOTAL_BYTES)) {
      throw new Error("Skill subdirectory exceeds the size limit");
    }
    files.push({
      path: entry.path.slice(subdirectory.length + 1),
      mode: entry.mode,
      content
    });
  }

  return { commit, files, totalBytes };
}

import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { readMiniAppManifest } from "$lib/server/miniapps/manifest.js";
import { isSafeRelativePath, isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import { MiniAppError, type MiniAppInstallSource } from "$lib/server/miniapps/types.js";

/**
 * Mini App installation from a local directory, a ZIP archive, or a GitHub
 * repository.
 *
 * **Trust.** A Mini App's server code runs inside the Molibot process with no
 * sandbox. Installing from a remote source therefore means running third-party
 * code with the owner's full privileges. This module does not pretend to make
 * that safe — signing, permission scopes and subprocess isolation are separate,
 * still-unbuilt work. What it does provide is *honesty and containment of the
 * install step itself*: the archive cannot write outside the staging directory,
 * the manifest must validate before anything reaches the live code root, and
 * the app's origin is recorded so the owner can always see what they are
 * running.
 *
 * Every install stages into a temporary directory first and atomically renames
 * into place, so a failure — a bad archive, an invalid manifest, a network drop
 * — leaves the existing installation untouched.
 */

/** An archive larger than this is refused before a single entry is read. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** Total uncompressed size, which is the real defence against a zip bomb. */
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** `owner/repo`, each segment restricted to GitHub's own allowed characters. */
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
/** A branch, tag or commit. Deliberately excludes anything shell- or path-like. */
const GITHUB_REF_PATTERN = /^[A-Za-z0-9][\w./-]{0,99}$/;

export type MiniAppInstallRequest =
  | { source: "directory"; path: string }
  | { source: "zip"; path: string }
  | { source: "github"; repo: string; ref?: string };

export interface MiniAppInstallResult {
  appId: string;
  /** True when this replaced an existing installation of the same id. */
  replaced: boolean;
  installSource: MiniAppInstallSource;
}

export interface MiniAppInstallerOptions {
  codeRoot: string;
  /** Records provenance so the manager can show where an app came from. */
  recordSource: (appId: string, source: MiniAppInstallSource, detail: { usesAi: boolean }) => void;
  /** Test seam. Production fetches from GitHub's codeload endpoint. */
  downloadArchive?: (url: string) => Promise<Buffer>;
}

function bad(message: string): never {
  throw new MiniAppError(message, "bad_request");
}

// ------------------------------------------------------------------ archives

interface ZipEntryFile {
  relativePath: string;
  read: () => Promise<Buffer>;
}

/**
 * Reads a ZIP into a flat list of files, rejecting anything that would let an
 * entry name escape the extraction root ("zip slip"), plus symlinks, absurd
 * entry counts, and a total unpacked size that a small archive could hide.
 */
async function readZipEntries(archive: Buffer): Promise<ZipEntryFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(new MiniAppError("The archive could not be opened as a ZIP file.", "bad_request"));
        return;
      }

      const files: ZipEntryFile[] = [];
      let unpackedBytes = 0;

      // yauzl refuses a traversing entry name itself, but reports it as a
      // generic stream error. Translating it keeps the owner from seeing
      // "corrupt" for an archive that is structurally fine but hostile.
      zip.on("error", (streamError: Error) => reject(new MiniAppError(
        /relative path|invalid characters/i.test(streamError?.message ?? "")
          ? `The archive contains an unsafe path: ${(streamError.message ?? "").slice(0, 80)}`
          : "The archive is corrupt.",
        "bad_request"
      )));
      zip.on("end", () => resolve(files));
      zip.on("entry", (entry) => {
        if (files.length >= MAX_ENTRIES) {
          reject(new MiniAppError(`The archive contains more than ${MAX_ENTRIES} entries.`, "bad_request"));
          return;
        }
        const rawName = entry.fileName;
        if (rawName.endsWith("/")) {
          zip.readEntry();
          return;
        }
        // Directory traversal, absolute paths, drive letters and null bytes are
        // all refused by the same syntactic gate the rest of the platform uses.
        if (!isSafeRelativePath(rawName)) {
          reject(new MiniAppError(`The archive contains an unsafe path: ${rawName.slice(0, 80)}`, "bad_request"));
          return;
        }
        // High 16 bits of externalFileAttributes carry the unix mode; S_IFLNK
        // means a symlink, which could point anywhere once extracted.
        const unixMode = (entry.externalFileAttributes ?? 0) >>> 16;
        if ((unixMode & 0o170000) === 0o120000) {
          reject(new MiniAppError(`The archive contains a symlink: ${rawName.slice(0, 80)}`, "bad_request"));
          return;
        }
        unpackedBytes += entry.uncompressedSize ?? 0;
        if (unpackedBytes > MAX_UNPACKED_BYTES) {
          reject(new MiniAppError("The archive expands to more than the allowed size.", "bad_request"));
          return;
        }

        files.push({
          relativePath: rawName,
          read: () => new Promise<Buffer>((resolveRead, rejectRead) => {
            zip.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) {
                rejectRead(new MiniAppError("An archive entry could not be read.", "bad_request"));
                return;
              }
              const chunks: Buffer[] = [];
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("error", () => rejectRead(new MiniAppError("An archive entry could not be read.", "bad_request")));
              stream.on("end", () => resolveRead(Buffer.concat(chunks)));
            });
          })
        });
        zip.readEntry();
      });

      zip.readEntry();
    });
  });
}

/**
 * GitHub archives wrap everything in a single `<repo>-<ref>/` directory, and an
 * app is sometimes zipped with its own folder around it. Strips one shared
 * leading segment so both shapes install identically.
 */
function stripCommonRoot(files: ZipEntryFile[]): ZipEntryFile[] {
  if (files.length === 0) return files;
  const firstSegments = new Set(files.map((file) => file.relativePath.split("/")[0]));
  if (firstSegments.size !== 1) return files;
  const hasNestedPaths = files.some((file) => file.relativePath.includes("/"));
  if (!hasNestedPaths) return files;
  return files.map((file) => ({
    ...file,
    relativePath: file.relativePath.split("/").slice(1).join("/")
  })).filter((file) => file.relativePath.length > 0);
}

// ----------------------------------------------------------------- staging

/** Copies a local directory into staging, refusing symlinks along the way. */
function copyDirectoryInto(sourceDir: string, targetDir: string): void {
  let totalBytes = 0;
  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      // Skip VCS and dependency noise so a repo checkout installs cleanly.
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fromPath = path.join(from, entry.name);
      const toPath = path.join(to, entry.name);
      // lstat semantics: a symlink is never followed, because following one
      // would copy content from outside the chosen directory.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fromPath, toPath);
        continue;
      }
      if (!entry.isFile()) continue;
      totalBytes += fs.statSync(fromPath).size;
      if (totalBytes > MAX_UNPACKED_BYTES) {
        bad("The source directory is larger than the allowed size.");
      }
      fs.copyFileSync(fromPath, toPath);
    }
  };
  walk(sourceDir, targetDir);
}

async function writeZipInto(files: ZipEntryFile[], targetDir: string): Promise<void> {
  for (const file of files) {
    const destination = path.join(targetDir, file.relativePath);
    // Belt and braces: the entry name was already validated, but the resolved
    // destination is checked against the staging root before anything is written.
    const resolved = path.resolve(destination);
    if (resolved !== path.resolve(targetDir) && !resolved.startsWith(path.resolve(targetDir) + path.sep)) {
      bad(`The archive contains an unsafe path: ${file.relativePath.slice(0, 80)}`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, await file.read());
  }
}

async function defaultDownloadArchive(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { accept: "application/zip", "user-agent": "molibot-miniapp-installer" }
  });
  if (!response.ok) {
    throw new MiniAppError(
      response.status === 404
        ? "The repository or ref was not found. Check the name and that the repository is public."
        : `Download failed with HTTP ${response.status}.`,
      "bad_request"
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) {
    throw new MiniAppError("The archive is larger than the allowed size.", "bad_request");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new MiniAppError("The archive is larger than the allowed size.", "bad_request");
  }
  return bytes;
}

export class MiniAppInstaller {
  constructor(private readonly options: MiniAppInstallerOptions) {}

  async install(request: MiniAppInstallRequest): Promise<MiniAppInstallResult> {
    const stagingDir = path.join(
      this.options.codeRoot,
      `.staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      const installSource = await this.materialize(request, stagingDir);
      return this.commit(stagingDir, installSource);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /** Puts the app's files into `stagingDir` and reports where they came from. */
  private async materialize(
    request: MiniAppInstallRequest,
    stagingDir: string
  ): Promise<MiniAppInstallSource> {
    if (request.source === "directory") {
      const sourceDir = path.resolve(String(request.path ?? ""));
      let stat: fs.Stats;
      try {
        stat = fs.statSync(sourceDir);
      } catch {
        bad("That directory does not exist.");
      }
      if (!stat.isDirectory()) bad("That path is not a directory.");
      // Installing from inside the code root would copy an app onto itself.
      if (path.resolve(sourceDir).startsWith(path.resolve(this.options.codeRoot) + path.sep)) {
        bad("That directory is already inside the Mini App install root.");
      }
      copyDirectoryInto(sourceDir, stagingDir);
      return { kind: "directory", label: path.basename(sourceDir) };
    }

    if (request.source === "zip") {
      const archivePath = path.resolve(String(request.path ?? ""));
      let stat: fs.Stats;
      try {
        stat = fs.statSync(archivePath);
      } catch {
        bad("That archive does not exist.");
      }
      if (!stat.isFile()) bad("That path is not a file.");
      if (stat.size > MAX_ARCHIVE_BYTES) bad("The archive is larger than the allowed size.");
      const files = stripCommonRoot(await readZipEntries(fs.readFileSync(archivePath)));
      await writeZipInto(files, stagingDir);
      return { kind: "zip", label: path.basename(archivePath) };
    }

    const repo = String(request.repo ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
    if (!GITHUB_REPO_PATTERN.test(repo)) {
      bad("Enter a GitHub repository as owner/repo or a github.com URL.");
    }
    const ref = String(request.ref ?? "").trim() || "HEAD";
    if (ref !== "HEAD" && !GITHUB_REF_PATTERN.test(ref)) {
      bad("That branch, tag or commit name is not valid.");
    }
    // codeload serves the archive directly; the URL is assembled from
    // pattern-checked segments so a crafted repo string cannot redirect it.
    const url = `https://codeload.github.com/${repo}/zip/${encodeURIComponent(ref)}`;
    const download = this.options.downloadArchive ?? defaultDownloadArchive;
    const files = stripCommonRoot(await readZipEntries(await download(url)));
    await writeZipInto(files, stagingDir);
    return { kind: "github", repo, ref };
  }

  /**
   * Validates the staged app and moves it into the code root.
   *
   * The manifest is validated *in staging*, so an invalid app never reaches a
   * place discovery would scan, and a failed replace leaves the previous
   * installation exactly as it was.
   */
  private commit(stagingDir: string, installSource: MiniAppInstallSource): MiniAppInstallResult {
    let manifestId: string;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(stagingDir, "manifest.json"), "utf8")) as { id?: unknown };
      if (!isValidMiniAppId(raw.id)) bad("manifest.json must declare a valid id (^[a-z][a-z0-9-]{1,62}$).");
      manifestId = raw.id;
    } catch (cause) {
      if (cause instanceof MiniAppError) throw cause;
      bad("No readable manifest.json was found at the top level of the source.");
    }

    // The validator requires the directory name to equal the manifest id, so
    // staging is renamed to the id before the full check runs.
    const namedStaging = path.join(path.dirname(stagingDir), `${manifestId}.installing`);
    fs.rmSync(namedStaging, { recursive: true, force: true });
    fs.renameSync(stagingDir, namedStaging);

    try {
      const validated = readMiniAppManifest(namedStaging, manifestId);
      if (!validated.ok) bad(`This is not a valid Mini App: ${validated.error}`);

      const target = path.join(this.options.codeRoot, manifestId);
      const replaced = fs.existsSync(target);
      // The previous build is kept until the new one is in place, so a failed
      // rename cannot leave the owner with no app at all.
      const backup = replaced ? `${target}.replacing-${Date.now()}` : null;
      if (backup) fs.renameSync(target, backup);
      try {
        fs.renameSync(namedStaging, target);
      } catch (cause) {
        if (backup) fs.renameSync(backup, target);
        throw cause;
      }
      if (backup) fs.rmSync(backup, { recursive: true, force: true });

      this.options.recordSource(manifestId, installSource, { usesAi: Boolean(validated.value.manifest.ai?.capabilities.length) });
      return { appId: manifestId, replaced, installSource };
    } finally {
      fs.rmSync(namedStaging, { recursive: true, force: true });
    }
  }
}

export function createMiniAppInstaller(options: MiniAppInstallerOptions): MiniAppInstaller {
  return new MiniAppInstaller(options);
}

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Shared machinery for content Molibot *ships* but the owner *owns*.
 *
 * Built-in Skills and built-in Agent templates have the same shape: a set of
 * files that live in the app bundle, are materialised into the owner's
 * workspace on install, and then have to be replaceable when a newer Molibot
 * ships a newer version — without ever silently destroying an edit the owner
 * made to their copy.
 *
 * The two callers differ only in policy (Skills install and upgrade
 * automatically at boot; Agent templates are installed and updated by hand from
 * Settings). The mechanics — hashing what we wrote, detecting divergence,
 * staging + rename so a crash can never leave a half-written tree, keeping a
 * backup when the copy diverged — are identical, so they live here once rather
 * than being forked per caller.
 */

export interface MaterializedEntry {
  version: string;
  installedAt: string;
  /**
   * sha256 of each file as *we* wrote it, so a later upgrade can tell an
   * untouched install from one the owner edited.
   *
   * Absent means "unknown provenance": a legacy entry written before hashes
   * existed, or a directory we merely adopted. Both are treated as diverged, so
   * an upgrade always keeps a backup of them.
   */
  files?: Record<string, string>;
}

export type MaterializedLedger = Record<string, MaterializedEntry>;

/**
 * Reject anything that could escape the bundle directory.
 *
 * This guards the shipped file map (ours, so mostly a formality) and — the
 * reason it exists — the ledger's recorded paths, which are read back from a
 * JSON file on disk and drive deletion of stale files. A corrupt or tampered
 * ledger must not be able to name `../../something`.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..")) return false;
  return !normalized.split(/[\\/]/).includes("..");
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function readFileHash(filePath: string): string | undefined {
  try {
    return hashContent(fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
}

/** Writes the shipped set into `targetDir`, returning the hash of each file. */
export function writeShippedFiles(
  targetDir: string,
  shippedFiles: Array<[string, string]>
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [relativePath, content] of shippedFiles) {
    const target = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    files[relativePath] = hashContent(content);
  }
  return files;
}

/**
 * First install: materialise into a staging directory and rename into place, so
 * a crash mid-write cannot leave a half-written tree that a loader would then
 * report as a broken-frontmatter diagnostic.
 */
export function installDirectory(
  targetDir: string,
  shippedFiles: Array<[string, string]>
): Record<string, string> {
  const stagingDir = `${targetDir}.installing`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  const files = writeShippedFiles(stagingDir, shippedFiles);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.renameSync(stagingDir, targetDir);
  return files;
}

/** True when the tree on disk is no longer byte-for-byte what we last wrote. */
export function hasDiverged(targetDir: string, recorded: Record<string, string> | undefined): boolean {
  // No recorded hashes means we cannot prove the tree is ours, so it is the
  // owner's until shown otherwise.
  if (!recorded) return true;
  return Object.entries(recorded).some(([relativePath, hash]) => {
    if (!isSafeRelativePath(relativePath)) return true;
    return readFileHash(path.join(targetDir, relativePath)) !== hash;
  });
}

/**
 * Replace an installed tree with the shipped version.
 *
 * Built in a staging copy and swapped in with two renames, so a crash cannot
 * leave a half-upgraded tree. The copy starts from what is on disk, which is
 * what carries owner-added files across; the shipped set is then written over
 * it. A diverged tree is preserved at `<dir>.backup-<timestamp>` instead of
 * being discarded — the owner's edits are never destroyed, only stepped aside.
 */
export function upgradeDirectory(
  targetDir: string,
  shippedFiles: Array<[string, string]>,
  previous: MaterializedEntry
): { files: Record<string, string>; backupDir?: string } {
  const recorded = previous.files;
  const diverged = hasDiverged(targetDir, recorded);

  const stagingDir = `${targetDir}.installing`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.cpSync(targetDir, stagingDir, { recursive: true });

  // Drop files we shipped last time and no longer ship — but only while they
  // still match what we wrote, so a file the owner took over is never deleted.
  const shippedPaths = new Set(shippedFiles.map(([relativePath]) => relativePath));
  for (const [relativePath, hash] of Object.entries(recorded ?? {})) {
    if (shippedPaths.has(relativePath) || !isSafeRelativePath(relativePath)) continue;
    const stale = path.join(stagingDir, relativePath);
    if (readFileHash(stale) === hash) fs.rmSync(stale, { force: true });
  }

  const files = writeShippedFiles(stagingDir, shippedFiles);

  const backupDir = diverged
    ? `${targetDir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
    : `${targetDir}.replacing`;
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.renameSync(targetDir, backupDir);
  fs.renameSync(stagingDir, targetDir);
  if (!diverged) fs.rmSync(backupDir, { recursive: true, force: true });

  return { files, backupDir: diverged ? backupDir : undefined };
}

export function readLedger(ledgerPath: string): MaterializedLedger {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ledger: MaterializedLedger = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      // Only a well-formed hash map counts. A partially readable one would make
      // an edited install look untouched, which is exactly the case that must
      // keep a backup — so anything odd degrades to "unknown provenance".
      const rawFiles = entry.files;
      let files: Record<string, string> | undefined;
      if (rawFiles && typeof rawFiles === "object" && !Array.isArray(rawFiles)) {
        files = {};
        for (const [relativePath, hash] of Object.entries(rawFiles as Record<string, unknown>)) {
          if (typeof hash !== "string" || !hash) { files = undefined; break; }
          files[relativePath] = hash;
        }
      }
      ledger[id] = {
        version: String(entry.version ?? ""),
        installedAt: String(entry.installedAt ?? ""),
        ...(files ? { files } : {})
      };
    }
    return ledger;
  } catch {
    // A missing or corrupt ledger must not block startup. The worst case is
    // that a deleted built-in comes back once, which is recoverable; refusing
    // to boot is not.
    return {};
  }
}

export function writeLedger(ledgerPath: string, ledger: MaterializedLedger): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, ledgerPath);
}

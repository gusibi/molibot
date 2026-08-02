import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import miniappCreatorSkill from "../../../../../skills/miniapp-creator/SKILL.md?raw";
import miniappCreatorReference from "../../../../../skills/miniapp-creator/reference.md?raw";
import miniappCreatorScaffold from "../../../../../skills/miniapp-creator/scripts/scaffold.mjs?raw";
import miniappTemplateManifest from "../../../../../skills/miniapp-creator/template/manifest.json?raw";
import miniappTemplateServer from "../../../../../skills/miniapp-creator/template/server/index.mjs?raw";
import miniappTemplateHtml from "../../../../../skills/miniapp-creator/template/ui/index.html?raw";
import miniappTemplateScript from "../../../../../skills/miniapp-creator/template/ui/app.js?raw";
import miniappTemplateStyle from "../../../../../skills/miniapp-creator/template/ui/styles.css?raw";
import miniappTemplateIcon from "../../../../../skills/miniapp-creator/template/ui/icon.svg?raw";

/**
 * Built-in Skill bootstrap.
 *
 * Skills are only ever read from the owner's workspace — `<dataRoot>/skills`,
 * `<workspace>/skills`, a project's `.agents/skills` — never from the app
 * bundle. The repository's own `skills/` directory is therefore invisible to a
 * packaged install: a Skill that ships with Molibot has to be *materialised
 * into the workspace*, exactly like a built-in Mini App.
 *
 * The files are embedded at build time (`?raw`) rather than copied from a
 * source directory, so a packaged build does not depend on the layout of the
 * machine it was built on, and the repository copy stays the single source of
 * truth (no forked duplicate under `src/`).
 *
 * Three rules keep this from ever surprising the owner:
 *
 * 1. **Only a version bump overwrites.** A skill at the version we last wrote
 *    is left completely alone, so a restart is never destructive. Shipping a
 *    new `version` is the one signal that says "replace what is on disk" —
 *    without it a fix to a bundled Skill could never reach an existing install,
 *    since the loader only ever reads the owner's workspace.
 * 2. **An overwrite is recoverable.** The ledger records the hash of every file
 *    as we wrote it. On upgrade, files still matching their recorded hash are
 *    replaced in place; if anything diverged — the owner edited it, or the
 *    directory was hand-installed and has no recorded hashes at all — the whole
 *    previous tree is renamed to `<id>.backup-<timestamp>` first. Files the
 *    owner *added* are carried across untouched either way.
 * 3. **Honour the tombstone.** The install ledger records every built-in that
 *    has been materialised. A skill whose directory is gone but whose record
 *    remains was deleted deliberately; reinstalling it on the next boot would
 *    resurrect something the owner threw away.
 */

const LEDGER_FILENAME = ".builtin-skills.json";
const SAFE_SKILL_ID = /^[a-z][a-z0-9-]{1,62}$/;

/**
 * Reject anything that could escape the skill directory.
 *
 * This guards the shipped file map (ours, so mostly a formality) and — the
 * reason it exists — the ledger's recorded paths, which are read back from a
 * JSON file on disk and drive deletion of stale files. A corrupt or tampered
 * ledger must not be able to name `../../something`.
 */
function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..")) return false;
  return !normalized.split(/[\\/]/).includes("..");
}

function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface BuiltinSkill {
  id: string;
  /**
   * Bump this whenever the shipped content changes. It is the only trigger for
   * replacing an installed copy — a build with new Skill content but the old
   * version number reaches nobody who already has it.
   */
  version: string;
  /** Skill-relative path → file content. */
  files: Record<string, string>;
}

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: "miniapp-creator",
    // 1.2.0: hyphenated ids get SQL-safe identifiers, and authoring now builds
    // in scratch before evidence-producing validate/install/inspect calls.
    version: "1.2.0",
    files: {
      "SKILL.md": miniappCreatorSkill,
      "reference.md": miniappCreatorReference,
      "scripts/scaffold.mjs": miniappCreatorScaffold,
      "template/manifest.json": miniappTemplateManifest,
      "template/server/index.mjs": miniappTemplateServer,
      "template/ui/index.html": miniappTemplateHtml,
      "template/ui/app.js": miniappTemplateScript,
      "template/ui/styles.css": miniappTemplateStyle,
      "template/ui/icon.svg": miniappTemplateIcon
    }
  }
];

interface LedgerEntry {
  version: string;
  installedAt: string;
  /**
   * sha256 of each file as *we* wrote it, so a later upgrade can tell an
   * untouched install from one the owner edited.
   *
   * Absent means "unknown provenance": a legacy entry written before hashes
   * existed, or a hand-installed directory we merely adopted. Both are treated
   * as diverged, so an upgrade always keeps a backup of them.
   */
  files?: Record<string, string>;
}

export interface EnsureBuiltinSkillsOptions {
  /** The global skills root, `<dataRoot>/skills`. */
  skillsRoot: string;
  /** Test seam: override the shipped set. */
  skills?: BuiltinSkill[];
}

export interface BuiltinSkillUpgrade {
  id: string;
  from: string;
  to: string;
  /** Set when the previous tree had diverged and was preserved instead of replaced. */
  backupDir?: string;
}

export interface EnsureBuiltinSkillsResult {
  installed: string[];
  upgraded: BuiltinSkillUpgrade[];
  skipped: Array<{ id: string; reason: "already-installed" | "removed-by-owner" | "failed" }>;
}

export function ensureBuiltinSkills(options: EnsureBuiltinSkillsOptions): EnsureBuiltinSkillsResult {
  const result: EnsureBuiltinSkillsResult = { installed: [], upgraded: [], skipped: [] };
  const skillsRoot = path.resolve(options.skillsRoot);
  fs.mkdirSync(skillsRoot, { recursive: true });

  const ledgerPath = path.join(skillsRoot, LEDGER_FILENAME);
  const ledger = readLedger(ledgerPath);
  let ledgerChanged = false;

  for (const skill of options.skills ?? BUILTIN_SKILLS) {
    if (!SAFE_SKILL_ID.test(skill.id)) continue;
    const shippedFiles = Object.entries(skill.files).filter(([relativePath]) => isSafeRelativePath(relativePath));
    if (shippedFiles.length === 0) continue;
    const skillDir = path.join(skillsRoot, skill.id);
    const existing = ledger[skill.id];

    if (fs.existsSync(skillDir)) {
      // Record a directory we did not write, too: if the owner later deletes a
      // hand-installed copy, that deletion is still a deliberate removal. No
      // hashes — we did not write this content, so an upgrade must treat it as
      // the owner's and back it up.
      if (!existing) {
        ledger[skill.id] = { version: skill.version, installedAt: new Date().toISOString() };
        ledgerChanged = true;
        result.skipped.push({ id: skill.id, reason: "already-installed" });
        continue;
      }
      if (existing.version === skill.version) {
        result.skipped.push({ id: skill.id, reason: "already-installed" });
        continue;
      }

      try {
        const upgrade = upgradeSkillDirectory(skillDir, shippedFiles, existing);
        ledger[skill.id] = {
          version: skill.version,
          installedAt: new Date().toISOString(),
          files: upgrade.files
        };
        ledgerChanged = true;
        result.upgraded.push({
          id: skill.id,
          from: existing.version,
          to: skill.version,
          backupDir: upgrade.backupDir
        });
      } catch {
        result.skipped.push({ id: skill.id, reason: "failed" });
      }
      continue;
    }

    if (existing) {
      result.skipped.push({ id: skill.id, reason: "removed-by-owner" });
      continue;
    }

    try {
      // Materialise into a staging directory and rename into place, so a crash
      // mid-write cannot leave a half-written skill that the loader would then
      // report as a broken frontmatter diagnostic.
      const stagingDir = `${skillDir}.installing`;
      fs.rmSync(stagingDir, { recursive: true, force: true });
      const files = writeShippedFiles(stagingDir, shippedFiles);
      fs.renameSync(stagingDir, skillDir);
      ledger[skill.id] = { version: skill.version, installedAt: new Date().toISOString(), files };
      ledgerChanged = true;
      result.installed.push(skill.id);
    } catch {
      result.skipped.push({ id: skill.id, reason: "failed" });
    }
  }

  if (ledgerChanged) writeLedger(ledgerPath, ledger);
  return result;
}

/** Writes the shipped set into `targetDir`, returning the hash of each file. */
function writeShippedFiles(
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
 * Replace an installed skill with the shipped version.
 *
 * Built in a staging copy and swapped in with two renames, so a crash cannot
 * leave a half-upgraded tree that the loader would report as broken. The copy
 * starts from what is on disk, which is what carries owner-added files across;
 * the shipped set is then written over it.
 */
function upgradeSkillDirectory(
  skillDir: string,
  shippedFiles: Array<[string, string]>,
  previous: LedgerEntry
): { files: Record<string, string>; backupDir?: string } {
  const recorded = previous.files;
  // No recorded hashes means we cannot prove the tree is ours, so it is the
  // owner's until shown otherwise.
  const diverged = !recorded || Object.entries(recorded).some(([relativePath, hash]) => {
    if (!isSafeRelativePath(relativePath)) return true;
    return readFileHash(path.join(skillDir, relativePath)) !== hash;
  });

  const stagingDir = `${skillDir}.installing`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.cpSync(skillDir, stagingDir, { recursive: true });

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
    ? `${skillDir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
    : `${skillDir}.replacing`;
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.renameSync(skillDir, backupDir);
  fs.renameSync(stagingDir, skillDir);
  if (!diverged) fs.rmSync(backupDir, { recursive: true, force: true });

  return { files, backupDir: diverged ? backupDir : undefined };
}

function readFileHash(filePath: string): string | undefined {
  try {
    return hashContent(fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
}

function readLedger(ledgerPath: string): Record<string, LedgerEntry> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ledger: Record<string, LedgerEntry> = {};
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

function writeLedger(ledgerPath: string, ledger: Record<string, LedgerEntry>): void {
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, ledgerPath);
}

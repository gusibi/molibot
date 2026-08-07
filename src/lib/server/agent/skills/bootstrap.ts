import fs from "node:fs";
import path from "node:path";
import {
  hasDiverged,
  installDirectory,
  isSafeRelativePath,
  readLedger,
  upgradeDirectory,
  writeLedger,
  type MaterializedEntry
} from "../bundles/materializedBundle";
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
    // 1.3.2: Geist visual layout and styling updates.
    version: "1.3.2",
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

type LedgerEntry = MaterializedEntry;

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
        const upgrade = upgradeDirectory(skillDir, shippedFiles, existing);
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
      const files = installDirectory(skillDir, shippedFiles);
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

export interface BuiltinSkillState {
  id: string;
  /** The version this build ships. */
  version: string;
  /** The version recorded for the copy on disk; empty when unknown. */
  installedVersion: string;
  installed: boolean;
  /** True when the shipped version differs from the installed one. */
  updateAvailable: boolean;
  /** True when the copy on disk no longer matches what we wrote. */
  modified: boolean;
}

/**
 * What the owner's workspace holds versus what this build ships.
 *
 * The boot path upgrades on a version bump on its own, so in normal operation
 * this reports "up to date". It exists for the two cases the boot path
 * deliberately does not handle: a copy the owner edited (still reported as
 * `modified`, so Settings can offer to re-apply it), and a version that was
 * skipped because the earlier attempt failed.
 */
export function listBuiltinSkillStates(options: EnsureBuiltinSkillsOptions): BuiltinSkillState[] {
  const skillsRoot = path.resolve(options.skillsRoot);
  const ledger = readLedger(path.join(skillsRoot, LEDGER_FILENAME));
  return (options.skills ?? BUILTIN_SKILLS)
    .filter((skill) => SAFE_SKILL_ID.test(skill.id))
    .map((skill) => {
      const entry = ledger[skill.id];
      const installed = fs.existsSync(path.join(skillsRoot, skill.id));
      return {
        id: skill.id,
        version: skill.version,
        installedVersion: installed ? entry?.version ?? "" : "",
        installed,
        updateAvailable: installed && (entry?.version ?? "") !== skill.version,
        modified: installed && hasDiverged(path.join(skillsRoot, skill.id), entry?.files)
      };
    });
}

export interface ApplyBuiltinSkillResult {
  id: string;
  from: string;
  to: string;
  /** Set when the previous tree had diverged and was preserved instead of replaced. */
  backupDir?: string;
  /** True when the skill was materialised for the first time (or after deletion). */
  installed: boolean;
}

/**
 * Write the shipped copy of one built-in Skill into the workspace, on request.
 *
 * Unlike the boot path this ignores both gates that exist to keep *automatic*
 * behaviour safe: the version check (so it can repair a copy that was edited or
 * half-written at the current version) and the tombstone (asking for it back is
 * exactly what an explicit request means). It keeps the one guarantee that is
 * not about automation: a diverged tree is backed up, never discarded.
 */
export function applyBuiltinSkill(
  options: EnsureBuiltinSkillsOptions & { id: string }
): ApplyBuiltinSkillResult {
  const skill = (options.skills ?? BUILTIN_SKILLS).find((candidate) => candidate.id === options.id);
  if (!skill || !SAFE_SKILL_ID.test(skill.id)) throw new Error(`Unknown built-in skill: ${options.id}`);
  const shippedFiles = Object.entries(skill.files).filter(([relativePath]) => isSafeRelativePath(relativePath));
  if (shippedFiles.length === 0) throw new Error(`Built-in skill ships no files: ${skill.id}`);

  const skillsRoot = path.resolve(options.skillsRoot);
  fs.mkdirSync(skillsRoot, { recursive: true });
  const ledgerPath = path.join(skillsRoot, LEDGER_FILENAME);
  const ledger = readLedger(ledgerPath);
  const skillDir = path.join(skillsRoot, skill.id);
  const previous = ledger[skill.id];
  const exists = fs.existsSync(skillDir);

  const applied = exists
    ? upgradeDirectory(skillDir, shippedFiles, previous ?? { version: "", installedAt: "" })
    : { files: installDirectory(skillDir, shippedFiles), backupDir: undefined };

  ledger[skill.id] = { version: skill.version, installedAt: new Date().toISOString(), files: applied.files };
  writeLedger(ledgerPath, ledger);

  return {
    id: skill.id,
    from: previous?.version ?? "",
    to: skill.version,
    backupDir: applied.backupDir,
    installed: !exists
  };
}

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
 * Two rules keep this from ever surprising the owner:
 *
 * 1. **Never overwrite.** An existing skill directory is left completely alone,
 *    so local edits and hand-installed versions survive every restart.
 * 2. **Honour the tombstone.** The install ledger records every built-in that
 *    has been materialised. A skill whose directory is gone but whose record
 *    remains was deleted deliberately; reinstalling it on the next boot would
 *    resurrect something the owner threw away.
 */

const LEDGER_FILENAME = ".builtin-skills.json";
const SAFE_SKILL_ID = /^[a-z][a-z0-9-]{1,62}$/;

export interface BuiltinSkill {
  id: string;
  /** Bumped when the shipped content changes; recorded, never auto-applied. */
  version: string;
  /** Skill-relative path → file content. */
  files: Record<string, string>;
}

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: "miniapp-creator",
    version: "1.0.0",
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
}

export interface EnsureBuiltinSkillsOptions {
  /** The global skills root, `<dataRoot>/skills`. */
  skillsRoot: string;
  /** Test seam: override the shipped set. */
  skills?: BuiltinSkill[];
}

export interface EnsureBuiltinSkillsResult {
  installed: string[];
  skipped: Array<{ id: string; reason: "already-installed" | "removed-by-owner" | "failed" }>;
}

export function ensureBuiltinSkills(options: EnsureBuiltinSkillsOptions): EnsureBuiltinSkillsResult {
  const result: EnsureBuiltinSkillsResult = { installed: [], skipped: [] };
  const skillsRoot = path.resolve(options.skillsRoot);
  fs.mkdirSync(skillsRoot, { recursive: true });

  const ledgerPath = path.join(skillsRoot, LEDGER_FILENAME);
  const ledger = readLedger(ledgerPath);
  let ledgerChanged = false;

  for (const skill of options.skills ?? BUILTIN_SKILLS) {
    if (!SAFE_SKILL_ID.test(skill.id)) continue;
    const skillDir = path.join(skillsRoot, skill.id);

    if (fs.existsSync(skillDir)) {
      // Record a directory we did not write, too: if the owner later deletes a
      // hand-installed copy, that deletion is still a deliberate removal.
      if (!ledger[skill.id]) {
        ledger[skill.id] = { version: skill.version, installedAt: new Date().toISOString() };
        ledgerChanged = true;
      }
      result.skipped.push({ id: skill.id, reason: "already-installed" });
      continue;
    }

    if (ledger[skill.id]) {
      result.skipped.push({ id: skill.id, reason: "removed-by-owner" });
      continue;
    }

    try {
      // Materialise into a staging directory and rename into place, so a crash
      // mid-write cannot leave a half-written skill that the loader would then
      // report as a broken frontmatter diagnostic.
      const stagingDir = `${skillDir}.installing`;
      fs.rmSync(stagingDir, { recursive: true, force: true });
      for (const [relativePath, content] of Object.entries(skill.files)) {
        const target = path.join(stagingDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
      }
      fs.renameSync(stagingDir, skillDir);
      ledger[skill.id] = { version: skill.version, installedAt: new Date().toISOString() };
      ledgerChanged = true;
      result.installed.push(skill.id);
    } catch {
      result.skipped.push({ id: skill.id, reason: "failed" });
    }
  }

  if (ledgerChanged) writeLedger(ledgerPath, ledger);
  return result;
}

function readLedger(ledgerPath: string): Record<string, LedgerEntry> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ledger: Record<string, LedgerEntry> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      ledger[id] = {
        version: String(entry.version ?? ""),
        installedAt: String(entry.installedAt ?? "")
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

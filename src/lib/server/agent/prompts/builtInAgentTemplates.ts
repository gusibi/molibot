import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter";
import {
  hasDiverged,
  readLedger,
  upgradeDirectory,
  writeLedger,
  writeShippedFiles,
  type MaterializedLedger
} from "$lib/server/agent/bundles/materializedBundle";
import { getAgentsRootDir } from "./profiles";
import type { BuiltInAgentTemplateSummary } from "$lib/shared/agentTemplates";

const REQUIRED_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md"] as const;
const COPYABLE_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
const SAFE_TEMPLATE_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Installed built-in Agents are tracked exactly like built-in Skills: which
 * version we wrote, and the hash of every file as we wrote it.
 *
 * Without this an installed Agent is frozen forever — the templates live in the
 * app bundle, the copy lives in the owner's workspace, and nothing connected
 * the two, so a fix shipped in a new Molibot reached only people who had never
 * installed the Agent. The ledger is what makes "有更新 → 更新" possible, and
 * the hashes are what make it safe: an Agent whose prompts the owner edited is
 * moved aside as a backup rather than overwritten in silence.
 */
const LEDGER_FILENAME = ".builtin-agents.json";

/**
 * A template with no `version:` in its frontmatter counts as 1.0.0 — the
 * baseline every curated template shipped at before versioning existed. Bumping
 * one is then a single frontmatter line, and forgetting the line on a *new*
 * template is harmless rather than a crash.
 */
const DEFAULT_TEMPLATE_VERSION = "1.0.0";

function candidateTemplateRoots(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(moduleDir, "templates"),
    path.resolve(process.cwd(), "src/lib/server/agent/prompts/templates")
  ];
}

export function resolveBuiltInAgentTemplatesRoot(explicitRoot?: string): string {
  if (explicitRoot) return path.resolve(explicitRoot);
  const root = candidateTemplateRoots().find((candidate) => fs.existsSync(candidate));
  if (!root) throw new Error("Built-in Agent templates directory not found");
  return root;
}

function resolveAgentsRoot(explicitRoot?: string): string {
  return explicitRoot ? path.resolve(explicitRoot) : getAgentsRootDir();
}

function isAgentTemplateDir(root: string, entry: fs.Dirent): boolean {
  if (!entry.isDirectory() || !SAFE_TEMPLATE_ID.test(entry.name)) return false;
  const dir = path.join(root, entry.name);
  return REQUIRED_FILES.every((fileName) => fs.existsSync(path.join(dir, fileName)));
}

function readTemplateMetadata(
  root: string,
  id: string
): Omit<BuiltInAgentTemplateSummary, "installed" | "installedVersion" | "updateAvailable" | "modified"> {
  const agentsPath = path.join(root, id, "AGENTS.md");
  const raw = fs.readFileSync(agentsPath, "utf8");
  const frontmatter = parseSkillFrontmatter(raw);
  const name = String(frontmatter?.name ?? "").trim();
  const description = String(frontmatter?.description ?? "").trim();
  if (!name || !description) {
    throw new Error(`Built-in Agent template ${id} requires name and description in AGENTS.md frontmatter`);
  }
  return {
    id,
    name,
    description,
    category: String(frontmatter?.category ?? "其他").trim() || "其他",
    source: String(frontmatter?.source ?? "MolipiBot").trim() || "MolipiBot",
    version: String(frontmatter?.version ?? "").trim() || DEFAULT_TEMPLATE_VERSION
  };
}

/** The shipped files of one template, as `[relativePath, content]` pairs. */
function readShippedFiles(sourceDir: string): Array<[string, string]> {
  return COPYABLE_FILES
    .filter((fileName) => fs.existsSync(path.join(sourceDir, fileName)))
    .map((fileName) => [fileName, fs.readFileSync(path.join(sourceDir, fileName), "utf8")] as [string, string]);
}

function ledgerPathFor(agentsRoot: string): string {
  return path.join(agentsRoot, LEDGER_FILENAME);
}

function describeInstallState(
  agentsRoot: string,
  ledger: MaterializedLedger,
  id: string,
  shippedVersion: string
): Pick<BuiltInAgentTemplateSummary, "installed" | "installedVersion" | "updateAvailable" | "modified"> {
  const agentDir = path.join(agentsRoot, id);
  const installed = fs.existsSync(agentDir);
  if (!installed) {
    return { installed: false, installedVersion: "", updateAvailable: false, modified: false };
  }
  // An install that predates the ledger has no recorded version. It is reported
  // as updatable rather than current: every copy installed before this feature
  // existed is by definition older than what this build ships, and claiming it
  // is up to date would hide the one update the owner actually needs.
  const entry = ledger[id];
  const installedVersion = entry?.version ?? "";
  return {
    installed: true,
    installedVersion,
    updateAvailable: installedVersion !== shippedVersion,
    modified: hasDiverged(agentDir, entry?.files)
  };
}

export function listBuiltInAgentTemplates(options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): BuiltInAgentTemplateSummary[] {
  const templatesRoot = resolveBuiltInAgentTemplatesRoot(options?.templatesRoot);
  const agentsRoot = resolveAgentsRoot(options?.agentsRoot);
  const ledger = readLedger(ledgerPathFor(agentsRoot));
  return fs.readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => isAgentTemplateDir(templatesRoot, entry))
    .map((entry) => {
      const metadata = readTemplateMetadata(templatesRoot, entry.name);
      return { ...metadata, ...describeInstallState(agentsRoot, ledger, entry.name, metadata.version) };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
}

interface ResolvedTemplate {
  id: string;
  templatesRoot: string;
  agentsRoot: string;
  sourceDir: string;
  agentDir: string;
  metadata: ReturnType<typeof readTemplateMetadata>;
}

function resolveTemplate(templateId: string, options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): ResolvedTemplate {
  const id = String(templateId ?? "").trim();
  if (!SAFE_TEMPLATE_ID.test(id)) throw new Error("Invalid built-in Agent template id");

  const templatesRoot = resolveBuiltInAgentTemplatesRoot(options?.templatesRoot);
  const agentsRoot = resolveAgentsRoot(options?.agentsRoot);
  const sourceDir = path.join(templatesRoot, id);
  if (!fs.existsSync(sourceDir) || !REQUIRED_FILES.every((fileName) => fs.existsSync(path.join(sourceDir, fileName)))) {
    throw new Error(`Built-in Agent template not found: ${id}`);
  }

  return {
    id,
    templatesRoot,
    agentsRoot,
    sourceDir,
    agentDir: path.join(agentsRoot, id),
    metadata: readTemplateMetadata(templatesRoot, id)
  };
}

export function installBuiltInAgentTemplate(templateId: string, options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): { template: BuiltInAgentTemplateSummary; agentDir: string } {
  const resolved = resolveTemplate(templateId, options);
  if (fs.existsSync(resolved.agentDir)) throw new Error(`Agent already exists: ${resolved.id}`);

  const shippedFiles = readShippedFiles(resolved.sourceDir);
  fs.mkdirSync(resolved.agentDir, { recursive: false });
  let files: Record<string, string>;
  try {
    files = writeShippedFiles(resolved.agentDir, shippedFiles);
  } catch (error) {
    fs.rmSync(resolved.agentDir, { recursive: true, force: true });
    throw error;
  }

  recordLedgerEntry(resolved.agentsRoot, resolved.id, resolved.metadata.version, files);

  return {
    template: {
      ...resolved.metadata,
      installed: true,
      installedVersion: resolved.metadata.version,
      updateAvailable: false,
      modified: false
    },
    agentDir: resolved.agentDir
  };
}

export interface BuiltInAgentTemplateUpdate {
  template: BuiltInAgentTemplateSummary;
  agentDir: string;
  from: string;
  to: string;
  /** Set when the installed copy had diverged and was preserved instead of replaced. */
  backupDir?: string;
}

/**
 * Re-apply the shipped copy of an installed built-in Agent.
 *
 * Owner edits are never destroyed: a diverged copy (including one installed
 * before the ledger existed, whose provenance we cannot prove) is renamed to
 * `<id>.backup-<timestamp>` before the new files land, and the caller surfaces
 * that path. Files the owner *added* are carried across either way.
 */
export function updateBuiltInAgentTemplate(templateId: string, options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): BuiltInAgentTemplateUpdate {
  const resolved = resolveTemplate(templateId, options);
  if (!fs.existsSync(resolved.agentDir)) throw new Error(`Agent is not installed: ${resolved.id}`);

  const ledgerPath = ledgerPathFor(resolved.agentsRoot);
  const ledger = readLedger(ledgerPath);
  const previous = ledger[resolved.id] ?? { version: "", installedAt: "" };
  const applied = upgradeDirectory(resolved.agentDir, readShippedFiles(resolved.sourceDir), previous);

  ledger[resolved.id] = {
    version: resolved.metadata.version,
    installedAt: new Date().toISOString(),
    files: applied.files
  };
  writeLedger(ledgerPath, ledger);

  return {
    template: {
      ...resolved.metadata,
      installed: true,
      installedVersion: resolved.metadata.version,
      updateAvailable: false,
      modified: false
    },
    agentDir: resolved.agentDir,
    from: previous.version,
    to: resolved.metadata.version,
    backupDir: applied.backupDir
  };
}

function recordLedgerEntry(
  agentsRoot: string,
  id: string,
  version: string,
  files: Record<string, string>
): void {
  const ledgerPath = ledgerPathFor(agentsRoot);
  const ledger = readLedger(ledgerPath);
  ledger[id] = { version, installedAt: new Date().toISOString(), files };
  writeLedger(ledgerPath, ledger);
}

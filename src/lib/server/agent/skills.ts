import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSkillFrontmatter } from "./skillFrontmatter.js";
import { resolveDataRootFromWorkspacePath } from "./workspace.js";

export type SkillScope = "chat" | "global" | "bot";

export interface LoadedSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: SkillScope;
  mcpServers: string[];
  aliases: string[];
}

export interface SkillLoadResult {
  skills: LoadedSkill[];
  diagnostics: string[];
}

interface SkillLoadOptions {
  disabledSkillPaths?: string[];
}

function parseStringList(raw: string | undefined): string[] {
  const source = String(raw ?? "").trim();
  if (!source) return [];

  if (source.startsWith("[") && source.endsWith("]")) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean);
      }
    } catch {
      // fall through to csv parsing
    }
  }

  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSkillNameAliases(name: string): Set<string> {
  const raw = String(name ?? "").trim().toLowerCase();
  const aliases = new Set<string>();
  if (!raw) return aliases;
  aliases.add(raw);
  const tokens = raw.split(/[\s_-]+/).filter(Boolean);
  if (tokens.length > 0) {
    aliases.add(tokens.join("-"));
    aliases.add(tokens.join("_"));
    aliases.add(tokens.join(""));
  }
  return aliases;
}

function buildSkillAliases(name: string, filePath: string): string[] {
  const aliases = buildSkillNameAliases(name);
  const dirAlias = basename(dirname(filePath));
  for (const alias of buildSkillNameAliases(dirAlias)) {
    aliases.add(alias);
  }
  return Array.from(aliases.values()).sort((a, b) => a.localeCompare(b));
}

function extractDirectSlashSelector(inputText: string): string | null {
  const match = String(inputText ?? "").trim().match(/^\/([^\s@]+)(?:@[^\s]+)?(?:\s|$)/);
  if (!match?.[1]) return null;
  return match[1].trim().toLowerCase();
}

function matchesExplicitInvocation(skill: LoadedSkill, inputText: string): boolean {
  const text = String(inputText ?? "").toLowerCase();
  if (!text.trim()) return false;

  const aliases = skill.aliases;
  if (aliases.length === 0) return false;

  const directSlashSelector = extractDirectSlashSelector(text);
  if (directSlashSelector && aliases.includes(directSlashSelector)) {
    return true;
  }

  for (const alias of aliases) {
    const explicitPatterns = [
      `$${alias}`,
      `/skill ${alias}`,
      `skill:${alias}`,
      `技能:${alias}`
    ];
    if (explicitPatterns.some((pattern) => text.includes(pattern))) {
      return true;
    }
  }

  return false;
}

function findSkillFiles(rootDir: string, out: string[]): void {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      findSkillFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      out.push(fullPath);
    }
  }
}

export function loadSkillsFromWorkspace(
  workspaceDir: string,
  chatId?: string,
  options?: SkillLoadOptions
): SkillLoadResult {
  const diagnostics: string[] = [];
  const disabled = new Set(
    (options?.disabledSkillPaths ?? [])
      .map((row) => String(row ?? "").trim())
      .filter(Boolean)
  );
  const dataRoot = resolveDataRootFromWorkspacePath(workspaceDir);
  const roots: Array<{ scope: SkillScope; dir: string }> = [];

  roots.push({ scope: "bot", dir: join(workspaceDir, "skills") });
  roots.push({ scope: "global", dir: join(dataRoot, "skills") });
  if (chatId?.trim()) {
    roots.push({ scope: "chat", dir: join(workspaceDir, chatId.trim(), "skills") });
  }

  const candidates: Array<{ scope: SkillScope; filePath: string }> = [];
  for (const root of roots) {
    if (!existsSync(root.dir)) continue;
    const rootFiles: string[] = [];
    findSkillFiles(root.dir, rootFiles);
    for (const filePath of rootFiles.sort((a, b) => a.localeCompare(b))) {
      candidates.push({ scope: root.scope, filePath });
    }
  }
  if (candidates.length === 0) return { skills: [], diagnostics: [] };

  const deduped = new Map<string, LoadedSkill>();
  for (const row of candidates) {
    const filePath = row.filePath;
    if (disabled.has(filePath)) continue;
    let raw = "";
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const fm = parseSkillFrontmatter(raw);
    if (!fm) {
      diagnostics.push(`Missing frontmatter in ${filePath}`);
      continue;
    }

    const name = fm.name?.trim();
    const description = fm.description?.trim();
    if (!name || !description) {
      diagnostics.push(`Missing name/description in ${filePath}`);
      continue;
    }

    if (deduped.has(name)) {
      diagnostics.push(
        `Duplicate skill name "${name}" ignored at ${filePath} (already loaded from ${deduped.get(name)?.filePath})`
      );
      continue;
    }

    deduped.set(name, {
      name,
      description,
      filePath,
      baseDir: dirname(filePath),
      scope: row.scope,
      mcpServers: parseStringList(fm.mcpServers ?? fm.mcp_servers),
      aliases: buildSkillAliases(name, filePath)
    });
  }

  return {
    skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics
  };
}

function compactSkillDescription(input: string, maxChars: number): string {
  const normalized = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const firstSentence = normalized.split(/(?<=[.!?。！？])\s+/)[0]?.trim() || normalized;
  const candidate = firstSentence.length <= maxChars ? firstSentence : normalized;
  if (candidate.length <= maxChars) return candidate;
  return `${candidate.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function formatSkillsForPrompt(
  skills: LoadedSkill[],
  options?: { compact?: boolean; maxDescriptionChars?: number }
): string {
  if (skills.length === 0) return "(no skills installed yet)";
  const compact = options?.compact === true;
  const maxDescriptionChars = options?.maxDescriptionChars ?? 140;
  return skills
    .map(
      (skill) =>
        `- ${skill.name}\n  description: ${
          compact ? compactSkillDescription(skill.description, maxDescriptionChars) : skill.description
        }\n  scope: ${skill.scope}\n  skill_file: ${skill.filePath}${
          skill.aliases.length > 0 ? `\n  aliases: ${skill.aliases.join(", ")}` : ""
        }${
          skill.mcpServers.length > 0 ? `\n  mcp_servers: ${skill.mcpServers.join(", ")}` : ""
        }`
    )
    .join("\n");
}

export function findExplicitlyInvokedSkills(skills: LoadedSkill[], inputText: string): LoadedSkill[] {
  return skills.filter((skill) => matchesExplicitInvocation(skill, inputText));
}

export function resolveRequestedMcpServerIds(skills: LoadedSkill[], inputText: string): string[] {
  const matched = new Set<string>();
  for (const skill of findExplicitlyInvokedSkills(skills, inputText)) {
    if (skill.mcpServers.length === 0) continue;
    for (const serverId of skill.mcpServers) {
      matched.add(serverId);
    }
  }
  return Array.from(matched.values());
}

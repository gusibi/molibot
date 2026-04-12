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

const TOKEN_PATTERN = /[a-z0-9][a-z0-9:_-]*/i;

function normalizeSelector(value: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^\/+/, "")
    .replace(/^skill[:\s]+/, "")
    .replace(/^技能[:\s]+/, "")
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function scopeWeight(scope: SkillScope): number {
  if (scope === "chat") return 3;
  if (scope === "bot") return 2;
  return 1;
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
  const raw = normalizeSelector(name);
  const aliases = new Set<string>();
  if (!raw) return aliases;
  aliases.add(raw);
  const tokens = raw.split(/[-]+/).filter(Boolean);
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
  const lines = String(inputText ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/")) continue;
    const match = trimmed.match(/^\/([a-z0-9][a-z0-9:_-]*)(?:@[^\s]+)?(?:\s|$)/i);
    if (!match?.[1]) continue;
    return normalizeSelector(match[1]);
  }
  return null;
}

function collectExplicitInvocationTokens(inputText: string): string[] {
  const text = String(inputText ?? "");
  if (!text.trim()) return [];
  const hits = new Set<string>();
  const tokenPattern = TOKEN_PATTERN.source;

  const directSlashSelector = extractDirectSlashSelector(text);
  if (directSlashSelector) hits.add(directSlashSelector);

  const genericPatterns = [
    new RegExp(`(?:^|\\s)\\$(${tokenPattern})\\b`, "gi"),
    // Language-agnostic label:value form, e.g. "skill:web-search" / "技能:web-search" / "スキル:web-search"
    new RegExp(`(?:^|\\s)(?!https?:\\/\\/)(?:[^\\s:]{1,12})\\s*:\\s*(${tokenPattern})\\b`, "gi"),
    // Language-agnostic slash-label value form, e.g. "/skill web-search" / "/技能 web-search" / "/기술 web-search"
    new RegExp(`(?:^|\\s)\\/(?:[^\\s/]{1,12})\\s+(${tokenPattern})\\b`, "gi"),
    new RegExp(`(?:^|[\\s([{\"'“‘])\\/(${tokenPattern})(?:@[^\s]+)?(?=$|[\\s)\\]}\"'”’，。,.!?;:：])`, "gi")
  ];

  for (const pattern of genericPatterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = normalizeSelector(match[1] ?? "");
      if (candidate) hits.add(candidate);
    }
  }

  return Array.from(hits.values());
}

function resolveSkillBySelector(skills: LoadedSkill[], selector: string): LoadedSkill | null {
  const normalized = normalizeSelector(selector);
  if (!normalized) return null;

  let best: LoadedSkill | null = null;
  let bestScore = -1;
  for (const skill of skills) {
    const aliasMatch = skill.aliases.some((alias) => normalizeSelector(alias) === normalized);
    if (!aliasMatch) continue;
    const exactNameBoost = normalizeSelector(skill.name) === normalized ? 10 : 0;
    const score = scopeWeight(skill.scope) * 100 + exactNameBoost;
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  return best;
}

function resolveExplicitInvocationMatches(skills: LoadedSkill[], inputText: string): LoadedSkill[] {
  const selectors = collectExplicitInvocationTokens(inputText);
  if (selectors.length === 0) return [];
  const matched = new Map<string, LoadedSkill>();
  for (const selector of selectors) {
    const resolved = resolveSkillBySelector(skills, selector);
    if (!resolved) continue;
    matched.set(resolved.filePath, resolved);
  }
  return Array.from(matched.values());
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
  const maxDescriptionChars = options?.maxDescriptionChars ?? 200;
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
  return resolveExplicitInvocationMatches(skills, inputText);
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

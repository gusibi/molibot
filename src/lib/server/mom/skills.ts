import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SkillScope = "chat" | "global" | "workspace-legacy";

export interface LoadedSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: SkillScope;
}

export interface SkillLoadResult {
  skills: LoadedSkill[];
  diagnostics: string[];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return null;

  const data: Record<string, string> = {};
  const body = match[1];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = stripQuotes(line.slice(idx + 1));
    if (key) data[key] = value;
  }
  return data;
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

function resolveDataRoot(workspaceDir: string): string {
  const normalized = workspaceDir.replace(/\\/g, "/");
  const marker = "/moli-t/";
  const idx = normalized.indexOf(marker);
  if (idx > 0) {
    return normalized.slice(0, idx);
  }
  return workspaceDir;
}

export function loadSkillsFromWorkspace(workspaceDir: string, chatId?: string): SkillLoadResult {
  const files: string[] = [];
  const diagnostics: string[] = [];
  const dataRoot = resolveDataRoot(workspaceDir);
  const roots: Array<{ scope: SkillScope; dir: string }> = [];

  if (chatId?.trim()) {
    roots.push({ scope: "chat", dir: join(workspaceDir, chatId.trim(), "skills") });
  }
  roots.push({ scope: "global", dir: join(dataRoot, "skills") });
  roots.push({ scope: "workspace-legacy", dir: join(workspaceDir, "skills") });

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
    let raw = "";
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const fm = parseFrontmatter(raw);
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
      scope: row.scope
    });
  }

  return {
    skills: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics
  };
}

export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "(no skills installed yet)";
  return skills
    .map(
      (skill) =>
        `- ${skill.name}\n  description: ${skill.description}\n  scope: ${skill.scope}\n  skill_file: ${skill.filePath}\n  base_dir: ${skill.baseDir}`
    )
    .join("\n");
}

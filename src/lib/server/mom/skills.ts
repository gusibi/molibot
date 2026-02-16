import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LoadedSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
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

export function loadSkillsFromWorkspace(workspaceDir: string): SkillLoadResult {
  const skillsDir = join(workspaceDir, "skills");
  if (!existsSync(skillsDir)) return { skills: [], diagnostics: [] };

  const files: string[] = [];
  const diagnostics: string[] = [];
  findSkillFiles(skillsDir, files);

  const deduped = new Map<string, LoadedSkill>();
  for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
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
      diagnostics.push(`Duplicate skill name "${name}" ignored at ${filePath}`);
      continue;
    }

    deduped.set(name, {
      name,
      description,
      filePath,
      baseDir: dirname(filePath)
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
        `- ${skill.name}\n  description: ${skill.description}\n  skill_file: ${skill.filePath}\n  base_dir: ${skill.baseDir}`
    )
    .join("\n");
}

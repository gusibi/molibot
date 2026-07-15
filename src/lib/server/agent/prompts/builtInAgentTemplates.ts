import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter";
import { getAgentDir } from "./profiles";
import type { BuiltInAgentTemplateSummary } from "$lib/shared/agentTemplates";

const REQUIRED_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md"] as const;
const COPYABLE_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
const SAFE_TEMPLATE_ID = /^[a-z0-9][a-z0-9-]*$/;

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

function isAgentTemplateDir(root: string, entry: fs.Dirent): boolean {
  if (!entry.isDirectory() || !SAFE_TEMPLATE_ID.test(entry.name)) return false;
  const dir = path.join(root, entry.name);
  return REQUIRED_FILES.every((fileName) => fs.existsSync(path.join(dir, fileName)));
}

function readTemplateMetadata(root: string, id: string): Omit<BuiltInAgentTemplateSummary, "installed"> {
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
    source: String(frontmatter?.source ?? "MolipiBot").trim() || "MolipiBot"
  };
}

export function listBuiltInAgentTemplates(options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): BuiltInAgentTemplateSummary[] {
  const templatesRoot = resolveBuiltInAgentTemplatesRoot(options?.templatesRoot);
  const agentsRoot = options?.agentsRoot ? path.resolve(options.agentsRoot) : path.dirname(getAgentDir("placeholder"));
  return fs.readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => isAgentTemplateDir(templatesRoot, entry))
    .map((entry) => {
      const metadata = readTemplateMetadata(templatesRoot, entry.name);
      return { ...metadata, installed: fs.existsSync(path.join(agentsRoot, entry.name)) };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
}

export function installBuiltInAgentTemplate(templateId: string, options?: {
  templatesRoot?: string;
  agentsRoot?: string;
}): { template: BuiltInAgentTemplateSummary; agentDir: string } {
  const id = String(templateId ?? "").trim();
  if (!SAFE_TEMPLATE_ID.test(id)) throw new Error("Invalid built-in Agent template id");

  const templatesRoot = resolveBuiltInAgentTemplatesRoot(options?.templatesRoot);
  const agentsRoot = options?.agentsRoot ? path.resolve(options.agentsRoot) : path.dirname(getAgentDir("placeholder"));
  const sourceDir = path.join(templatesRoot, id);
  if (!fs.existsSync(sourceDir) || !REQUIRED_FILES.every((fileName) => fs.existsSync(path.join(sourceDir, fileName)))) {
    throw new Error(`Built-in Agent template not found: ${id}`);
  }

  const agentDir = path.join(agentsRoot, id);
  if (fs.existsSync(agentDir)) throw new Error(`Agent already exists: ${id}`);

  const metadata = readTemplateMetadata(templatesRoot, id);
  fs.mkdirSync(agentDir, { recursive: false });
  try {
    for (const fileName of COPYABLE_FILES) {
      const sourcePath = path.join(sourceDir, fileName);
      if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(agentDir, fileName));
    }
  } catch (error) {
    fs.rmSync(agentDir, { recursive: true, force: true });
    throw error;
  }

  return {
    template: { ...metadata, installed: true },
    agentDir
  };
}

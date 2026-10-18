import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import { isSkillBackupDirectory } from "$lib/server/agent/skills/skills.js";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";
import { isKnownProvider } from "$lib/server/settings";
import { updateSkillsConfig } from "$lib/server/settings/handlers/skills";

type SkillScope = "global" | "agent" | "chat";

interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: SkillScope;
  enabled: boolean;
  mcpServers: string[];
  agentId?: string;
  chatId?: string;
}

interface SkillSearchProviderItem {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
}

function collectSkillFiles(rootDir: string, out: string[]): void {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (isSkillBackupDirectory(entry.name)) continue;
      collectSkillFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      out.push(fullPath);
    }
  }
}

function parseSkillFile(
  filePath: string,
  scope: SkillScope,
  diagnostics: string[],
  agentId?: string,
  chatId?: string,
): SkillItem | null {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const fm = parseSkillFrontmatter(raw);
  if (!fm) {
    diagnostics.push(`Missing frontmatter in ${filePath}`);
    return null;
  }
  const name = fm.name?.trim();
  const description = fm.description?.trim();
  if (!name || !description) {
    diagnostics.push(`Missing name/description in ${filePath}`);
    return null;
  }
  return {
    name,
    description,
    filePath,
    baseDir: dirname(filePath),
    scope,
    enabled: true,
    mcpServers: (() => {
      const raw = String(fm.mcpServers ?? fm.mcp_servers ?? "").trim();
      if (!raw) return [];
      if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
          }
        } catch {
          // fall through
        }
      }
      return raw.split(",").map((item) => item.trim()).filter(Boolean);
    })(),
    agentId,
    chatId
  };
}

export const GET: RequestHandler = async () => {
  const { getSettings } = getRuntime();
  const settings = getSettings();
  const disabledSet = new Set(settings.disabledSkillPaths ?? []);
  const dataRoot = resolve(config.dataDir);
  const globalSkillsDir = join(dataRoot, "skills");
  // Sessions are stored per Agent: each directory under sessions/ is one
  // Agent's workspace, so its skills/ directory holds that Agent's own skills.
  const agentsRoot = join(dataRoot, "sessions");
  const diagnostics: string[] = [];
  const items: SkillItem[] = [];

  if (existsSync(globalSkillsDir)) {
    const files: string[] = [];
    collectSkillFiles(globalSkillsDir, files);
    for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
      const item = parseSkillFile(filePath, "global", diagnostics);
      if (item) items.push(item);
    }
  }

  if (existsSync(agentsRoot)) {
    const agentEntries = readdirSync(agentsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const agent of agentEntries) {
      const agentId = agent.name;
      const agentDir = join(agentsRoot, agentId);

      const agentSkillsDir = join(agentDir, "skills");
      if (existsSync(agentSkillsDir)) {
        const files: string[] = [];
        collectSkillFiles(agentSkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseSkillFile(filePath, "agent", diagnostics, agentId);
          if (item) items.push(item);
        }
      }


    }
  }

  const count = {
    global: items.filter((i) => i.scope === "global").length,
    chat: items.filter((i) => i.scope === "chat").length,
    agent: items.filter((i) => i.scope === "agent").length
  };

  for (const item of items) {
    item.enabled = !disabledSet.has(item.filePath);
  }

  const searchProviders: SkillSearchProviderItem[] = settings.customProviders
    .filter((provider) => provider.enabled !== false)
    .filter((provider) => !isKnownProvider(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      defaultModel: provider.defaultModel,
      models: provider.models.map((model) => model.id).filter(Boolean)
    }))
    .filter((provider) => provider.models.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return json({
    ok: true,
    dataRoot,
    globalSkillsDir,
    skillSearch: settings.skillSearch,
    searchProviders,
    items,
    count,
    diagnostics
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { disabledSkillPaths?: unknown; skillSearch?: unknown };
  try {
    body = (await request.json()) as { disabledSkillPaths?: unknown; skillSearch?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = updateSkillsConfig(getRuntime(), body);
    return json({ ok: true, ...result });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

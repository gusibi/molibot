import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import { parseSkillFrontmatter } from "$lib/server/agent/skillFrontmatter.js";
import { isKnownProvider } from "$lib/server/settings";

type SkillScope = "global" | "chat" | "bot";

interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: SkillScope;
  enabled: boolean;
  mcpServers: string[];
  botId?: string;
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
  botId?: string,
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
    botId,
    chatId
  };
}

export const GET: RequestHandler = async () => {
  const { getSettings } = getRuntime();
  const settings = getSettings();
  const disabledSet = new Set(settings.disabledSkillPaths ?? []);
  const dataRoot = resolve(config.dataDir);
  const globalSkillsDir = join(dataRoot, "skills");
  const botsRoot = join(dataRoot, "moli-t", "bots");
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

  if (existsSync(botsRoot)) {
    const botEntries = readdirSync(botsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const bot of botEntries) {
      const botId = bot.name;
      const botDir = join(botsRoot, botId);

      const botSkillsDir = join(botDir, "skills");
      if (existsSync(botSkillsDir)) {
        const files: string[] = [];
        collectSkillFiles(botSkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseSkillFile(filePath, "bot", diagnostics, botId);
          if (item) items.push(item);
        }
      }

      const chatEntries = readdirSync(botDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "skills");
      for (const chat of chatEntries) {
        const chatId = chat.name;
        const chatSkillsDir = join(botDir, chatId, "skills");
        if (!existsSync(chatSkillsDir)) continue;
        const files: string[] = [];
        collectSkillFiles(chatSkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseSkillFile(filePath, "chat", diagnostics, botId, chatId);
          if (item) items.push(item);
        }
      }
    }
  }

  const count = {
    global: items.filter((i) => i.scope === "global").length,
    chat: items.filter((i) => i.scope === "chat").length,
    bot: items.filter((i) => i.scope === "bot").length
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

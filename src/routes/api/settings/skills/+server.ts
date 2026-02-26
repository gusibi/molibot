import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/config";

type SkillScope = "global" | "chat" | "workspace-legacy";

interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: SkillScope;
  botId?: string;
  chatId?: string;
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
  for (const rawLine of match[1].split("\n")) {
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
  const fm = parseFrontmatter(raw);
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
    botId,
    chatId
  };
}

export const GET: RequestHandler = async () => {
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

      const legacySkillsDir = join(botDir, "skills");
      if (existsSync(legacySkillsDir)) {
        const files: string[] = [];
        collectSkillFiles(legacySkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseSkillFile(filePath, "workspace-legacy", diagnostics, botId);
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
    workspaceLegacy: items.filter((i) => i.scope === "workspace-legacy").length
  };

  return json({
    ok: true,
    dataRoot,
    globalSkillsDir,
    items,
    count,
    diagnostics
  });
};

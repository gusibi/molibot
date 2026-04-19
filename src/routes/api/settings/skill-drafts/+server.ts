import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import { deleteSkillDraftFile, overwriteSkillDraft, readSkillDrafts } from "$lib/server/agent/reviewData";
import { parseSkillFrontmatter } from "$lib/server/agent/skillFrontmatter";
import { promoteDraftToLiveSkill } from "$lib/server/agent/skillDraft";
import type { SkillScope } from "$lib/server/agent/skills";

type SkillDraftAction = "save" | "delete" | "promote";

interface SkillDraftBody {
  action?: SkillDraftAction;
  filePath?: string;
  content?: string;
  workspaceDir?: string;
  chatId?: string;
  scope?: SkillScope;
  overwrite?: boolean;
  archiveDraft?: boolean;
  name?: string;
}

interface SkillTemplateOption {
  name: string;
  description: string;
  filePath: string;
  scope: SkillScope;
  botId?: string;
  chatId?: string;
}

function collectSkillFiles(rootDir: string, out: string[]): void {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectSkillFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") out.push(fullPath);
  }
}

function parseTemplateOption(
  filePath: string,
  scope: SkillScope,
  botId?: string,
  chatId?: string
): SkillTemplateOption | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const fm = parseSkillFrontmatter(raw);
    const name = fm?.name?.trim();
    const description = fm?.description?.trim();
    if (!name || !description) return null;
    return { name, description, filePath, scope, botId, chatId };
  } catch {
    return null;
  }
}

function readTemplateSkillOptions(dataRoot: string): SkillTemplateOption[] {
  const items: SkillTemplateOption[] = [];
  const globalSkillsDir = resolve(dataRoot, "skills");
  const botsRoot = resolve(dataRoot, "moli-t", "bots");

  if (existsSync(globalSkillsDir)) {
    const files: string[] = [];
    collectSkillFiles(globalSkillsDir, files);
    for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
      const item = parseTemplateOption(filePath, "global");
      if (item) items.push(item);
    }
  }

  if (existsSync(botsRoot)) {
    const botEntries = readdirSync(botsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const botEntry of botEntries) {
      const botId = botEntry.name;
      const botDir = resolve(botsRoot, botId);
      const botSkillsDir = resolve(botDir, "skills");
      if (existsSync(botSkillsDir)) {
        const files: string[] = [];
        collectSkillFiles(botSkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseTemplateOption(filePath, "bot", botId);
          if (item) items.push(item);
        }
      }

      const chatEntries = readdirSync(botDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "skills");
      for (const chatEntry of chatEntries) {
        const chatId = chatEntry.name;
        const chatSkillsDir = resolve(botDir, chatId, "skills");
        if (!existsSync(chatSkillsDir)) continue;
        const files: string[] = [];
        collectSkillFiles(chatSkillsDir, files);
        for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
          const item = parseTemplateOption(filePath, "chat", botId, chatId);
          if (item) items.push(item);
        }
      }
    }
  }

  return items;
}

function isAllowedDraftPath(dataRoot: string, filePath: string): boolean {
  const normalized = resolve(filePath);
  const allowedRoot = resolve(dataRoot, "moli-t", "bots");
  return normalized.startsWith(allowedRoot) && normalized.includes("/skill-drafts/") && normalized.endsWith(".md");
}

function isAllowedWorkspaceDir(dataRoot: string, workspaceDir: string): boolean {
  const normalized = resolve(workspaceDir);
  const allowedRoot = resolve(dataRoot, "moli-t", "bots");
  return normalized.startsWith(allowedRoot);
}

export const GET: RequestHandler = async () => {
  const dataRoot = resolve(config.dataDir);
  const settings = getRuntime().getSettings();
  const { items, diagnostics } = readSkillDrafts(dataRoot);

  return json({
    ok: true,
    dataRoot,
    skillDrafts: settings.skillDrafts,
    templateSkills: readTemplateSkillOptions(dataRoot),
    items,
    diagnostics,
    counts: {
      total: items.length,
      botCount: new Set(items.map((item) => item.botId)).size,
      chatCount: new Set(items.map((item) => `${item.botId}:${item.chatId}`)).size
    }
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: SkillDraftBody;
  try {
    body = (await request.json()) as SkillDraftBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (!action) {
    return json({ ok: false, error: "Missing action" }, { status: 400 });
  }

  const dataRoot = resolve(config.dataDir);
  const filePath = String(body.filePath ?? "").trim();
  if (!filePath || !isAllowedDraftPath(dataRoot, filePath)) {
    return json({ ok: false, error: "Invalid skill draft path" }, { status: 400 });
  }

  if (action === "save") {
    const content = String(body.content ?? "");
    if (!content.trim()) {
      return json({ ok: false, error: "content is required" }, { status: 400 });
    }
    overwriteSkillDraft(filePath, content);
    return json({ ok: true });
  }

  if (action === "delete") {
    deleteSkillDraftFile(filePath);
    return json({ ok: true });
  }

  if (action === "promote") {
    const workspaceDir = String(body.workspaceDir ?? "").trim();
    const chatId = String(body.chatId ?? "").trim();
    const scope = (body.scope ?? "chat") as SkillScope;
    if (!workspaceDir || !chatId || !isAllowedWorkspaceDir(dataRoot, workspaceDir)) {
      return json({ ok: false, error: "workspaceDir and chatId are required" }, { status: 400 });
    }
    const saved = promoteDraftToLiveSkill({
      draftPath: filePath,
      workspaceDir,
      chatId,
      scope,
      overwrite: Boolean(body.overwrite),
      archiveDraft: body.archiveDraft !== false,
      name: typeof body.name === "string" ? body.name : undefined
    });
    return json({ ok: true, saved });
  }

  return json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
};

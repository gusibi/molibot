import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { deleteSkillDraftFile, overwriteSkillDraft, readSkillDrafts } from "$lib/server/agent/reviewData";
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
  const { items, diagnostics } = readSkillDrafts(dataRoot);

  return json({
    ok: true,
    dataRoot,
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

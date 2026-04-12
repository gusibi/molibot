import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SkillScope } from "../skills.js";
import {
  mergeSkillDraftMarkdown,
  promoteDraftToLiveSkill,
  readSkillDraft,
  saveLiveSkill,
  saveSkillDraft,
  updateLiveSkill
} from "../skillDraft.js";

const skillManageSchema = Type.Object({
  action: Type.Union([
    Type.Literal("draft"),
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("promote_draft"),
    Type.Literal("read_draft"),
    Type.Literal("list_drafts")
  ]),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  goal: Type.Optional(Type.String()),
  steps: Type.Optional(Type.Array(Type.String())),
  triggers: Type.Optional(Type.Array(Type.String())),
  content: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("bot"), Type.Literal("chat")])),
  overwrite: Type.Optional(Type.Boolean()),
  archiveDraft: Type.Optional(Type.Boolean())
});

function normalizeScope(input: unknown): SkillScope {
  return input === "global" || input === "chat" ? input : "bot";
}

function buildManualSkillMarkdown(params: {
  name: string;
  description: string;
  goal?: string;
  steps?: string[];
  triggers?: string[];
}): string {
  const aliases = [params.name, params.name.replace(/-/g, ""), params.name.replace(/-/g, "_")]
    .filter(Boolean)
    .join(", ");
  const steps = Array.isArray(params.steps) && params.steps.length > 0
    ? params.steps.map((step, index) => `${index + 1}. ${step}`)
    : ["1. Fill in the actual workflow steps."];
  const triggers = Array.isArray(params.triggers) && params.triggers.length > 0
    ? params.triggers.join(", ")
    : params.name;

  return [
    "---",
    `name: ${params.name}`,
    `description: ${params.description}`,
    `aliases: [${aliases}]`,
    "---",
    "",
    "# When To Use",
    `- Trigger words or requests: ${triggers}`,
    "",
    "# Goal",
    `- ${params.goal?.trim() || params.description}`,
    "",
    "# Steps",
    ...steps,
    "",
    "# Verification",
    "- Check the output before replying.",
    "",
    "# Pitfalls",
    "- Add real pitfalls after validating this workflow.",
    ""
  ].join("\n");
}

export function createSkillManageTool(options: {
  workspaceDir: string;
  chatId: string;
}): AgentTool<typeof skillManageSchema> {
  return {
    name: "skill_manage",
    label: "skill_manage",
    description:
      "Draft or save reusable skills. Prefer `draft` first for newly-discovered workflows. Do not create a live skill unless the workflow has been validated.",
    parameters: skillManageSchema,
    execute: async (_toolCallId, params) => {
      const action = params.action;

      if (action === "list_drafts") {
        const dir = resolve(options.workspaceDir, "skill-drafts");
        let files: string[] = [];
        try {
          files = readdirSync(dir).sort();
        } catch {
          files = [];
        }
        return {
          content: [{ type: "text", text: files.length > 0 ? files.join("\n") : "(no drafts)" }],
          details: { files }
        };
      }

      if (action === "read_draft") {
        const filePath = String(params.filePath ?? "").trim();
        if (!filePath) throw new Error("filePath is required for read_draft");
        const content = readSkillDraft(filePath);
        return {
          content: [{ type: "text", text: content }],
          details: { filePath }
        };
      }

      if (action === "draft") {
        const name = String(params.name ?? "").trim() || "reusable-workflow";
        const description = String(params.description ?? "").trim() || name;
        const manualContent = buildManualSkillMarkdown({
          name,
          description,
          goal: typeof params.goal === "string" ? params.goal : undefined,
          steps: Array.isArray(params.steps) ? params.steps : undefined,
          triggers: Array.isArray(params.triggers) ? params.triggers : undefined
        });
        const saved = saveSkillDraft({
          workspaceDir: options.workspaceDir,
          chatId: options.chatId,
          userMessage: description,
          finalAnswer: typeof params.goal === "string" ? params.goal : description,
          toolNames: [],
          failedToolNames: [],
          explicitSkillNames: [],
          modelFailures: []
        });
        updateLiveSkill({
          filePath: saved.filePath,
          content: mergeSkillDraftMarkdown(readSkillDraft(saved.filePath), manualContent)
        });
        return {
          content: [{ type: "text", text: `Saved skill draft: ${saved.filePath}` }],
          details: { filePath: saved.filePath }
        };
      }

      if (action === "create") {
        const name = String(params.name ?? "").trim();
        const description = String(params.description ?? "").trim();
        if (!name || !description) {
          throw new Error("name and description are required for create");
        }
        const content = typeof params.content === "string" && params.content.trim()
          ? params.content
          : buildManualSkillMarkdown({
              name,
              description,
              goal: typeof params.goal === "string" ? params.goal : undefined,
              steps: Array.isArray(params.steps) ? params.steps : undefined,
              triggers: Array.isArray(params.triggers) ? params.triggers : undefined
            });
        const saved = saveLiveSkill({
          workspaceDir: options.workspaceDir,
          chatId: options.chatId,
          scope: normalizeScope(params.scope),
          name,
          content,
          overwrite: params.overwrite === true
        });
        return {
          content: [{ type: "text", text: `Created skill: ${saved.filePath}` }],
          details: { filePath: saved.filePath }
        };
      }

      if (action === "promote_draft") {
        const filePath = String(params.filePath ?? "").trim();
        if (!filePath) throw new Error("filePath is required for promote_draft");
        const saved = promoteDraftToLiveSkill({
          draftPath: filePath,
          workspaceDir: options.workspaceDir,
          chatId: options.chatId,
          scope: normalizeScope(params.scope),
          overwrite: params.overwrite === true,
          archiveDraft: params.archiveDraft !== false,
          name: typeof params.name === "string" ? params.name : undefined
        });
        return {
          content: [{ type: "text", text: `Promoted draft to skill: ${saved.filePath}` }],
          details: { filePath: saved.filePath }
        };
      }

      if (action === "update") {
        const filePath = String(params.filePath ?? "").trim();
        const content = String(params.content ?? "").trim();
        if (!filePath || !content) {
          throw new Error("filePath and content are required for update");
        }
        const saved = updateLiveSkill({ filePath, content });
        return {
          content: [{ type: "text", text: `Updated skill: ${saved.filePath}` }],
          details: { filePath: saved.filePath }
        };
      }

      throw new Error(`Unsupported action: ${action}`);
    }
  };
}

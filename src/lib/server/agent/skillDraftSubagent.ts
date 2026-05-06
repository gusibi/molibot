import type { RuntimeSettings } from "../settings/index.js";
import { momLog, momWarn } from "./log.js";
import type { SkillDraftMetadata, SkillDraftMetadataContext } from "./skillDraftMetadata.js";
import { buildSkillDraftMetadata, slugifySkillName } from "./skillDraftMetadata.js";
import { runBuiltInSubagentTask } from "./tools/subagent.js";

export interface SkillDraftMetadataSubagentOptions {
  cwd: string;
  workspaceDir: string;
  chatId: string;
  settings: RuntimeSettings;
  signal?: AbortSignal;
}

function compactLine(input: string, max = 220): string {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max).trimEnd();
}

function extractJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input ?? "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeMetadata(
  raw: Record<string, unknown>,
  fallback: SkillDraftMetadata
): SkillDraftMetadata {
  const name = slugifySkillName(String(raw.name ?? ""), fallback.name);
  const description = compactLine(String(raw.description ?? ""), 220) || fallback.description;
  const rawAliases = Array.isArray(raw.aliases)
    ? raw.aliases.map((item) => slugifySkillName(String(item ?? ""), "")).filter(Boolean)
    : [];
  const aliases = [...new Set([name, name.replace(/-/g, ""), name.replace(/-/g, "_"), ...rawAliases])].filter(Boolean);
  return {
    name,
    description,
    aliases,
    trigger: fallback.trigger
  };
}

function buildTask(context: SkillDraftMetadataContext): string {
  return [
    "Generate Skill Draft frontmatter metadata for this completed run.",
    "",
    "Return JSON only. Do not include Markdown fences.",
    "",
    "Input:",
    JSON.stringify({
      userMessage: context.userMessage,
      finalAnswer: compactLine(context.finalAnswer, 1200),
      toolNames: context.toolNames,
      requestedName: context.requestedName,
      requestedDescription: context.requestedDescription,
      requestedTriggers: context.requestedTriggers
    }, null, 2)
  ].join("\n");
}

export async function buildSkillDraftMetadataViaSubagent(
  context: SkillDraftMetadataContext,
  options: SkillDraftMetadataSubagentOptions
): Promise<SkillDraftMetadata | null> {
  const fallback = buildSkillDraftMetadata(context);
  try {
    momLog("runner", "skill_draft_subagent_start", {
      chatId: options.chatId,
      fallbackName: fallback.name
    });
    const result = await runBuiltInSubagentTask({
      agent: "skill-drafter",
      task: buildTask(context),
      cwd: options.cwd,
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      settings: options.settings,
      signal: options.signal
    });
    const parsed = extractJsonObject(result.output);
    if (!parsed) {
      momWarn("runner", "skill_draft_subagent_invalid_output", {
        chatId: options.chatId,
        outputPreview: compactLine(result.output, 240)
      });
      return null;
    }
    const metadata = normalizeMetadata(parsed, fallback);
    momLog("runner", "skill_draft_subagent_end", {
      chatId: options.chatId,
      name: metadata.name,
      model: result.model,
      usageTotal: result.usage.total
    });
    return metadata;
  } catch (error) {
    momWarn("runner", "skill_draft_subagent_failed", {
      chatId: options.chatId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSkillFrontmatter } from "./skillFrontmatter.js";
import type { RunSummary } from "./runSummary.js";

export interface AgentWorkspaceRef {
  botId: string;
  chatId: string;
  workspaceDir: string;
}

export interface RunHistoryItem {
  runId: string;
  createdAt: string;
  botId: string;
  chatId: string;
  workspaceDir: string;
  filePath: string;
  stopReason: "stop" | "aborted" | "error";
  durationMs: number;
  finalText: string;
  toolNames: string[];
  failedToolNames: string[];
  explicitSkillNames: string[];
  usedFallbackModel: boolean;
  modelFailureSummaries: string[];
  reflectionOutcome: "success" | "partial" | "failed";
  reflectionSummary: string;
  nextAction: string;
  memorySelectedCount: number;
  skillDraftPath: string;
}

export interface SkillDraftItem {
  filePath: string;
  fileName: string;
  botId: string;
  chatId: string;
  workspaceDir: string;
  name: string;
  description: string;
  draft: boolean;
  source: string;
  mergeCount: number;
  updatedAt: string;
  content: string;
}

interface BotWorkspaceRef {
  botId: string;
  chatId: string;
  workspaceDir: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

export function listAgentWorkspaces(dataRoot: string): AgentWorkspaceRef[] {
  const botsRoot = resolve(dataRoot, "moli-t", "bots");
  if (!existsSync(botsRoot)) return [];

  const items: AgentWorkspaceRef[] = [];
  for (const bot of readdirSync(botsRoot, { withFileTypes: true })) {
    if (!bot.isDirectory()) continue;
    const botDir = join(botsRoot, bot.name);
    for (const chat of readdirSync(botDir, { withFileTypes: true })) {
      if (!chat.isDirectory() || chat.name === "skills") continue;
      items.push({
        botId: bot.name,
        chatId: chat.name,
        workspaceDir: botDir
      });
    }
  }

  return items.sort((a, b) => {
    const botOrder = a.botId.localeCompare(b.botId);
    return botOrder !== 0 ? botOrder : a.chatId.localeCompare(b.chatId);
  });
}

function listBotWorkspaces(dataRoot: string): BotWorkspaceRef[] {
  const deduped = new Map<string, BotWorkspaceRef>();
  for (const workspace of listAgentWorkspaces(dataRoot)) {
    const key = resolve(workspace.workspaceDir);
    const existing = deduped.get(key);
    if (!existing || workspace.chatId.localeCompare(existing.chatId) < 0) {
      deduped.set(key, workspace);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => a.botId.localeCompare(b.botId));
}

function parseRunSummaryLine(raw: string, createdAtFallback: string): RunSummary | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<RunSummary> & { createdAt?: string };
    return {
      runId: String(parsed.runId ?? ""),
      stopReason: parsed.stopReason === "aborted" || parsed.stopReason === "error" ? parsed.stopReason : "stop",
      durationMs: Number(parsed.durationMs ?? 0),
      finalText: String(parsed.finalText ?? ""),
      toolNames: Array.isArray(parsed.toolNames) ? parsed.toolNames.map((item) => String(item ?? "")) : [],
      failedToolNames: Array.isArray(parsed.failedToolNames) ? parsed.failedToolNames.map((item) => String(item ?? "")) : [],
      explicitSkillNames: Array.isArray(parsed.explicitSkillNames)
        ? parsed.explicitSkillNames.map((item) => String(item ?? ""))
        : [],
      usedFallbackModel: Boolean(parsed.usedFallbackModel),
      modelFailureSummaries: Array.isArray(parsed.modelFailureSummaries)
        ? parsed.modelFailureSummaries.map((item) => String(item ?? ""))
        : [],
      budget: parsed.budget ?? { toolCalls: 0, toolFailures: 0, modelAttempts: 0 },
      budgetLimits: parsed.budgetLimits ?? { maxToolCalls: 0, maxToolFailures: 0, maxModelAttempts: 0 },
      memorySnapshot: parsed.memorySnapshot,
      reflection: parsed.reflection,
      skillDraft: parsed.skillDraft,
      errorMessage: parsed.errorMessage,
      createdAt: String(parsed.createdAt ?? createdAtFallback)
    } as RunSummary & { createdAt: string };
  } catch {
    return null;
  }
}

export function parseRunHistoryLine(raw: string, fallbackCreatedAt = new Date(0).toISOString()): RunSummary | null {
  return parseRunSummaryLine(raw, fallbackCreatedAt);
}

export function parseSkillDraftItem(input: {
  filePath: string;
  fileName?: string;
  botId: string;
  chatId: string;
  workspaceDir: string;
  content: string;
  updatedAt: string;
}): SkillDraftItem {
  const fm = parseSkillFrontmatter(input.content) ?? {};
  return {
    filePath: input.filePath,
    fileName: input.fileName ?? input.filePath.split("/").pop() ?? "draft.md",
    botId: input.botId,
    chatId: input.chatId,
    workspaceDir: input.workspaceDir,
    name: String(fm.name ?? (input.fileName ?? input.filePath.split("/").pop() ?? "draft").replace(/\.md$/i, "")),
    description: String(fm.description ?? ""),
    draft: String(fm.draft ?? "").toLowerCase() === "true",
    source: String(fm.source ?? ""),
    mergeCount: Number(fm.merge_count ?? "1") || 1,
    updatedAt: input.updatedAt,
    content: input.content
  };
}

export function readRunHistory(dataRoot: string, limit = 200): { items: RunHistoryItem[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const items: RunHistoryItem[] = [];

  for (const workspace of listAgentWorkspaces(dataRoot)) {
    const filePath = join(workspace.workspaceDir, workspace.chatId, "run-summaries.jsonl");
    if (!existsSync(filePath)) continue;

    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
    } catch (error) {
      diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const lines = content.split(/\r?\n/).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const parsed = parseRunSummaryLine(lines[index] ?? "", new Date(0).toISOString());
      if (!parsed) {
        diagnostics.push(`Skipped invalid summary line ${index + 1} in ${filePath}`);
        continue;
      }
      const createdAt = String((parsed as RunSummary & { createdAt?: string }).createdAt ?? new Date(0).toISOString());
      items.push({
        runId: parsed.runId,
        createdAt,
        botId: workspace.botId,
        chatId: workspace.chatId,
        workspaceDir: workspace.workspaceDir,
        filePath,
        stopReason: parsed.stopReason,
        durationMs: parsed.durationMs,
        finalText: parsed.finalText,
        toolNames: unique(parsed.toolNames),
        failedToolNames: unique(parsed.failedToolNames),
        explicitSkillNames: unique(parsed.explicitSkillNames),
        usedFallbackModel: parsed.usedFallbackModel,
        modelFailureSummaries: unique(parsed.modelFailureSummaries),
        reflectionOutcome: parsed.reflection?.outcome ?? (parsed.stopReason === "error" ? "failed" : "success"),
        reflectionSummary: parsed.reflection?.summary ?? "",
        nextAction: parsed.reflection?.nextAction ?? "",
        memorySelectedCount: Number(parsed.memorySnapshot?.selectedCount ?? 0),
        skillDraftPath: String(parsed.skillDraft?.filePath ?? "")
      });
    }
  }

  items.sort((a, b) => {
    const timeOrder = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return timeOrder !== 0 ? timeOrder : b.runId.localeCompare(a.runId);
  });

  return {
    items: items.slice(0, Math.max(1, limit)),
    diagnostics
  };
}

export function readSkillDrafts(dataRoot: string): { items: SkillDraftItem[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const items: SkillDraftItem[] = [];

  for (const workspace of listBotWorkspaces(dataRoot)) {
    const draftsDir = join(workspace.workspaceDir, "skill-drafts");
    if (!existsSync(draftsDir)) continue;

    for (const entry of readdirSync(draftsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const filePath = join(draftsDir, entry.name);
      let content = "";
      try {
        content = readFileSync(filePath, "utf8");
      } catch (error) {
        diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      items.push(parseSkillDraftItem({
        filePath,
        fileName: entry.name,
        botId: workspace.botId,
        chatId: workspace.chatId,
        workspaceDir: workspace.workspaceDir,
        updatedAt: statSync(filePath).mtime.toISOString(),
        content
      }));
    }
  }

  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return { items, diagnostics };
}

export function overwriteSkillDraft(filePath: string, content: string): void {
  writeFileSync(resolve(filePath), content, "utf8");
}

export function deleteSkillDraftFile(filePath: string): void {
  unlinkSync(resolve(filePath));
}

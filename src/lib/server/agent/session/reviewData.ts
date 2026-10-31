import { createAgentFileReferenceResolver } from "$lib/server/sessions/agentFileReferences.js";
import { isAgentWorkspace } from "$lib/server/sessions/agentStorage.js";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { setImmediate as yieldToRequests } from "node:timers/promises";
import { join, resolve } from "node:path";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";
import type { RunSummary } from "$lib/server/agent/session/runSummary.js";

export interface AgentWorkspaceRef {
  botId: string;
  chatId: string;
  workspaceDir: string;
}

export interface RunHistoryItem {
  runId: string;
  workspaceId?: string;
  createdAt: string;
  botId: string;
  chatId: string;
  workspaceDir: string;
  filePath: string;
  stopReason: "stop" | "aborted" | "error" | "waiting_for_approval";
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

const RESERVED_CHAT_DIRS = new Set([
  "skills",
  "skill-drafts",
  "events",
  "scratch",
  "attachments",
  "contexts"
]);

export function listAgentWorkspaces(dataRoot: string): AgentWorkspaceRef[] {
  const root = resolve(dataRoot);
  const items: AgentWorkspaceRef[] = [];
  const scannedBotsRoots = new Set<string>();

  function collectFromBotsRoot(botsRoot: string, prefix = ""): void {
    const resolvedBotsRoot = resolve(botsRoot);
    if (scannedBotsRoots.has(resolvedBotsRoot)) return;
    scannedBotsRoots.add(resolvedBotsRoot);
    if (!existsSync(resolvedBotsRoot)) return;
    for (const bot of readdirSync(resolvedBotsRoot, { withFileTypes: true })) {
      if (!bot.isDirectory()) continue;
      const botDir = join(resolvedBotsRoot, bot.name);
      const botId = prefix ? `${prefix}${bot.name}` : bot.name;
      for (const chat of readdirSync(botDir, { withFileTypes: true })) {
        if (!chat.isDirectory() || RESERVED_CHAT_DIRS.has(chat.name)) continue;
        items.push({
          botId,
          chatId: chat.name,
          workspaceDir: botDir
        });
      }
    }
  }

  const agentsRoot = join(root, "sessions");
  if (existsSync(agentsRoot)) for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) items.push({ botId: entry.name, chatId: "", workspaceDir: join(agentsRoot, entry.name) });
  }

  // 2. System bots
  collectFromBotsRoot(join(root, "system", "bots"));

  // 3. Projects runtime workspaces
  const projectsRoot = join(root, "projects");
  if (existsSync(projectsRoot)) {
    for (const project of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const runtimeDir = join(projectsRoot, project.name, "runtime");
      if (!existsSync(runtimeDir)) continue;
      for (const chat of readdirSync(runtimeDir, { withFileTypes: true })) {
        if (!chat.isDirectory() || RESERVED_CHAT_DIRS.has(chat.name)) continue;
        items.push({
          botId: `project:${project.name}`,
          chatId: chat.name,
          workspaceDir: runtimeDir
        });
      }
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
      workspaceId: String(parsed.workspaceId ?? "").trim() || undefined,
      stopReason:
        parsed.stopReason === "aborted" ||
        parsed.stopReason === "error" ||
        parsed.stopReason === "waiting_for_approval"
          ? parsed.stopReason
          : "stop",
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
      budget: parsed.budget ?? { toolCalls: 0, toolFailures: 0, modelFailures: 0, modelTurns: 0 },
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

export async function readRunHistory(dataRoot: string, limit = 200): Promise<{ items: RunHistoryItem[]; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const maxItems = Math.max(1, Math.min(500, Math.floor(limit) || 200));
  const candidates: Array<{ parsed: RunSummary & { createdAt?: string }; workspace: AgentWorkspaceRef; filePath: string }> = [];
  const seenFiles = new Set<string>();
  let scannedLines = 0;
  const compare = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => {
    const timeA = Date.parse(a.parsed.createdAt ?? "") || 0;
    const timeB = Date.parse(b.parsed.createdAt ?? "") || 0;
    return timeB - timeA || b.parsed.runId.localeCompare(a.parsed.runId);
  };

  for (const workspace of listAgentWorkspaces(dataRoot)) {
    const histories = [join(workspace.workspaceDir, workspace.chatId, "run-summaries.jsonl")];
    const historyRoot = join(workspace.workspaceDir, "run-history");
    if (isAgentWorkspace(workspace.workspaceDir) && existsSync(historyRoot)) {
      for (const entry of readdirSync(historyRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) histories.push(join(historyRoot, entry.name, "run-summaries.jsonl"));
      }
    }
    for (const filePath of histories) {
      if (seenFiles.has(filePath) || !existsSync(filePath)) continue;
      seenFiles.add(filePath);
      const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
      let lineNumber = 0;
      try {
        for await (const line of lines) {
          lineNumber++;
          if (++scannedLines % 128 === 0) await yieldToRequests();
          if (!line.trim()) continue;
          const parsed = parseRunSummaryLine(line, new Date(0).toISOString());
          if (!parsed) {
            diagnostics.push(`Skipped invalid summary line ${lineNumber} in ${filePath}`);
            continue;
          }
          const candidate = { parsed, workspace, filePath };
          // Keep only the newest candidates, including when imported logs arrive out of order.
          let low = 0;
          let high = candidates.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (compare(candidate, candidates[mid]!) < 0) high = mid;
            else low = mid + 1;
          }
          if (low < maxItems) {
            candidates.splice(low, 0, candidate);
            if (candidates.length > maxItems) candidates.pop();
          }
        }
      } catch (error) {
        diagnostics.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        lines.close();
      }
    }
  }

  const resolvers = new Map<string, (reference: string) => string>();
  const items = candidates.map(({ parsed, workspace, filePath }): RunHistoryItem => {
    let skillDraftPath = String(parsed.skillDraft?.filePath ?? "");
    if (skillDraftPath && isAgentWorkspace(workspace.workspaceDir)) {
      let resolveReference = resolvers.get(workspace.workspaceDir);
      if (!resolveReference) {
        resolveReference = createAgentFileReferenceResolver(workspace.workspaceDir);
        resolvers.set(workspace.workspaceDir, resolveReference);
      }
      skillDraftPath = resolveReference(skillDraftPath);
    }
    return {
      runId: parsed.runId,
      workspaceId: parsed.workspaceId,
      createdAt: parsed.createdAt ?? new Date(0).toISOString(),
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
      reflectionOutcome: parsed.reflection?.outcome ?? (parsed.stopReason === "error" ? "failed" : parsed.stopReason === "waiting_for_approval" ? "partial" : "success"),
      reflectionSummary: parsed.reflection?.summary ?? "",
      nextAction: parsed.reflection?.nextAction ?? "",
      memorySelectedCount: Number(parsed.memorySnapshot?.selectedCount ?? 0),
      skillDraftPath
    };
  });
  return { items, diagnostics };
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

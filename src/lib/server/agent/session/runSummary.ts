import type { SavedSkillDraft } from "$lib/server/agent/skills/skillDraft.js";
import type { RunBudgetLimits, RunBudgetSnapshot } from "$lib/server/agent/core/runtimeBudget.js";
import type { MemoryPromptSnapshot } from "$lib/server/memory/types.js";

export interface RunReflection {
  outcome: "success" | "partial" | "failed";
  summary: string;
  nextAction: string;
}

export interface RunSummarySubagentTask {
  mode: "single" | "parallel" | "chain";
  agent?: string;
  taskIndex?: number;
  taskCount: number;
  taskPreview?: string;
  stopReason?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface RunSummarySubagent {
  delegationNoticeSent: boolean;
  invoked: boolean;
  taskCount: number;
  tasks: RunSummarySubagentTask[];
}

export interface RunSummary {
  runId: string;
  workspaceId?: string;
  sessionId?: string;
  stopReason: "stop" | "aborted" | "error" | "waiting_for_approval";
  durationMs: number;
  finalText: string;
  toolNames: string[];
  failedToolNames: string[];
  explicitSkillNames: string[];
  usedFallbackModel: boolean;
  modelFailureSummaries: string[];
  budget: RunBudgetSnapshot;
  budgetLimits: RunBudgetLimits;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  memorySnapshot?: Pick<MemoryPromptSnapshot, "createdAt" | "fingerprint" | "query"> & {
    selectedCount: number;
    longTermCount: number;
    dailyCount: number;
  };
  subagent?: RunSummarySubagent;
  reflection?: RunReflection;
  skillDraft?: SavedSkillDraft;
  errorMessage?: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

export function formatRunClosingNote(summary: RunSummary): string {
  if (summary.skillDraft) {
    return `Saved a reusable draft: ${summary.skillDraft.filePath}`;
  }

  const lines: string[] = [];
  lines.push("Run summary");
  lines.push(`- Result: ${summary.stopReason}${summary.errorMessage ? ` (${summary.errorMessage})` : ""}`);
  lines.push(`- Duration: ${Math.max(1, Math.round(summary.durationMs / 1000))}s`);
  lines.push(
    `- Budget: tools ${summary.budget.toolCalls}/${summary.budgetLimits.maxToolCalls}, failed tools ${summary.budget.toolFailures}/${summary.budgetLimits.maxToolFailures}, model attempts ${summary.budget.modelAttempts}/${summary.budgetLimits.maxModelAttempts}`
  );

  const tools = unique(summary.toolNames);
  if (tools.length > 0) {
    lines.push(`- Tools used: ${tools.join(", ")}`);
  }

  const failedTools = unique(summary.failedToolNames);
  if (failedTools.length > 0) {
    lines.push(`- Tool failures: ${failedTools.join(", ")}`);
  }

  if (summary.subagent?.invoked) {
    const agents = unique(summary.subagent.tasks.map((task) => task.agent ?? ""));
    lines.push(`- Subagent tasks: ${summary.subagent.tasks.length}${agents.length > 0 ? ` (${agents.join(", ")})` : ""}`);
  } else if (summary.subagent?.delegationNoticeSent) {
    lines.push("- Subagent: delegation recommended but not used");
  }

  if (summary.explicitSkillNames.length > 0) {
    lines.push(`- Explicit skills: ${unique(summary.explicitSkillNames).join(", ")}`);
  }

  if (summary.usedFallbackModel) {
    lines.push("- Model fallback: yes");
  }

  if (summary.modelFailureSummaries.length > 0) {
    lines.push(`- Model issues: ${summary.modelFailureSummaries.join(" | ")}`);
  }

  if (summary.memorySnapshot) {
    lines.push(
      `- Memory snapshot: ${summary.memorySnapshot.selectedCount} items (${summary.memorySnapshot.longTermCount} long-term, ${summary.memorySnapshot.dailyCount} daily)`
    );
  }

  if (summary.reflection) {
    lines.push(`- Reflection: ${summary.reflection.summary}`);
    lines.push(`- Next action: ${summary.reflection.nextAction}`);
  }

  return lines.join("\n");
}

export function buildRunReflection(input: {
  stopReason: "stop" | "aborted" | "error" | "waiting_for_approval";
  finalText: string;
  failedToolNames: string[];
  usedFallbackModel: boolean;
  errorMessage?: string;
  skillDraftSaved?: boolean;
}): RunReflection {
  if (input.stopReason === "error") {
    return {
      outcome: "failed",
      summary: input.errorMessage?.trim() || "Run ended with an error.",
      nextAction: input.failedToolNames.length > 0
        ? `Check the failing path first: ${unique(input.failedToolNames).join(", ")}.`
        : "Retry only after checking the blocking runtime or model issue."
    };
  }

  if (input.stopReason === "waiting_for_approval") {
    return {
      outcome: "partial",
      summary: "Run is paused and waiting for host-tool approval.",
      nextAction: "Approve or reject the pending host-tool request before continuing."
    };
  }

  if (input.usedFallbackModel || input.failedToolNames.length > 0) {
    return {
      outcome: "partial",
      summary: "Run finished, but only after fallback or recoverable failures.",
      nextAction: input.skillDraftSaved
        ? "Review the saved workflow draft and turn it into a stable skill if the path is worth reusing."
        : "Review the failing steps and decide whether this path deserves a reusable skill draft."
    };
  }

  return {
    outcome: "success",
    summary: "Run completed on the primary path.",
    nextAction: input.skillDraftSaved
      ? "Review the saved workflow draft and keep the reusable parts."
      : "No immediate follow-up needed unless you want to formalize this workflow as a skill."
  };
}

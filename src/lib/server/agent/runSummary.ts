import type { SavedSkillDraft } from "./skillDraft.js";
import type { RunBudgetLimits, RunBudgetSnapshot } from "./runtimeBudget.js";
import type { MemoryPromptSnapshot } from "../memory/types.js";

export interface RunReflection {
  outcome: "success" | "partial" | "failed";
  summary: string;
  nextAction: string;
}

export interface RunSummary {
  runId: string;
  stopReason: "stop" | "aborted" | "error";
  durationMs: number;
  finalText: string;
  toolNames: string[];
  failedToolNames: string[];
  explicitSkillNames: string[];
  usedFallbackModel: boolean;
  modelFailureSummaries: string[];
  budget: RunBudgetSnapshot;
  budgetLimits: RunBudgetLimits;
  memorySnapshot?: Pick<MemoryPromptSnapshot, "createdAt" | "fingerprint" | "query"> & {
    selectedCount: number;
    longTermCount: number;
    dailyCount: number;
  };
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

  if (summary.skillDraft) {
    lines.push(`- Skill draft ${summary.skillDraft.merged ? "merged into" : "saved"}: ${summary.skillDraft.filePath}`);
  }

  if (summary.reflection) {
    lines.push(`- Reflection: ${summary.reflection.summary}`);
    lines.push(`- Next action: ${summary.reflection.nextAction}`);
  }

  return lines.join("\n");
}

export function buildRunReflection(input: {
  stopReason: "stop" | "aborted" | "error";
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

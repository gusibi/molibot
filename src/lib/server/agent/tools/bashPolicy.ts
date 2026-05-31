import { findApprovedHostBash, tryParseHostBashCommand } from "$lib/server/agent/tools/bash.js";
import { createDefaultApprovalRequest } from "$lib/server/agent/tools/toolRuntime.js";
import type { PolicyDecision, ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";

export function decideBashToolPolicy(options: {
  tool: ToolDefinition;
  input: unknown;
  ctx: ToolExecutionContext;
  sandboxEnabled: boolean;
  hostBashStore?: ReturnType<typeof getHostBashStore>;
}): PolicyDecision {
  const params = options.input as { command?: string; hostApproval?: any };
  const parsed = tryParseHostBashCommand(params?.command ?? "");
  const approved = findApprovedHostBash(options.hostBashStore ?? getHostBashStore(), parsed);
  if (approved) {
    return { type: "allow" };
  }

  if (!options.sandboxEnabled) {
    return { type: "allow" };
  }

  if (params?.hostApproval) {
    return {
      type: "approval_required",
      request: createDefaultApprovalRequest(options.tool, options.input, options.ctx)
    };
  }

  return { type: "allow" };
}


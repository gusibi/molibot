import type { ToolRiskLevel, ToolSource } from "$lib/server/agent/tools/toolTypes.js";

export interface RuntimeToolClassificationOptions {
  /**
   * Tool comes from a third-party pi extension. Such tools are never "builtin":
   * classifying them honestly keeps approval capability strings and audit logs
   * from attributing extension behaviour to Molibot itself.
   */
  isExtensionTool?: boolean;
}

/**
 * Pure helper: maps a tool name to its runtime risk classification and source.
 * Extracted for testability and used by wrapWithToolRuntime.
 */
export function getRuntimeToolClassification(
  toolName: string,
  options: RuntimeToolClassificationOptions = {}
): {
  risk: ToolRiskLevel;
  source: ToolSource;
} {
  if (toolName === "bash") {
    return { risk: "high", source: "host" };
  }
  // Installing an extension downloads and executes third-party code. "Install
  // this plugin" can appear in content the agent read rather than coming from
  // the owner, so this always reaches the approval broker.
  if (toolName === "extensionManage") {
    return { risk: "critical", source: "builtin" };
  }
  if (options.isExtensionTool) {
    return { risk: "medium", source: "plugin" };
  }
  if (["write", "edit"].includes(toolName)) {
    return { risk: "medium", source: "builtin" };
  }
  if (toolName === "webSearch") {
    return { risk: "medium", source: "builtin" };
  }
  if (toolName.startsWith("mcp__")) {
    return { risk: "medium", source: "mcp" };
  }
  return { risk: "low", source: "builtin" };
}

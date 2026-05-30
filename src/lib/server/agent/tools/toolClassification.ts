/**
 * Pure helper: maps a tool name to its runtime risk classification and source.
 * Extracted for testability and used by wrapWithToolRuntime.
 */
export function getRuntimeToolClassification(toolName: string): {
  risk: "low" | "medium" | "high";
  source: "builtin" | "mcp" | "host";
} {
  if (toolName === "bash") {
    return { risk: "high", source: "host" };
  }
  if (["write", "edit"].includes(toolName)) {
    return { risk: "medium", source: "builtin" };
  }
  if (toolName.startsWith("mcp__")) {
    return { risk: "medium", source: "mcp" };
  }
  return { risk: "low", source: "builtin" };
}

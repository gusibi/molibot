function extractToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  return details && typeof details === "object" ? details as Record<string, unknown> : undefined;
}

export function resolveToolDisplayName(
  toolName: string,
  options: { result?: unknown; sandboxAttempted?: boolean } = {}
): string {
  if (toolName !== "bash") return toolName;
  const details = extractToolResultDetails(options.result);
  if (details) {
    if (details.sandboxApplied === true) return "Sandbox";
    if (typeof details.sandboxWarning === "string" && details.sandboxWarning) return "Sandbox disabled";
    if (details.sandboxApplied === false) return toolName;
  }
  return options.sandboxAttempted ? "Sandbox" : toolName;
}

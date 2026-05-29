import {
  parseHostBashShellCommand,
  sanitizeHostBashId,
  type ApprovedHostBashEntry
} from "$lib/server/hostBash/index.js";

function extractToolResultDetails(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  return details && typeof details === "object" ? details as Record<string, unknown> : undefined;
}

interface HostBashLookupStore {
  getApprovedEntry(toolId: string): ApprovedHostBashEntry | null | undefined;
}

export function resolvePlannedBashDisplayName(options: {
  command?: unknown;
  hostBashStore?: HostBashLookupStore;
  sandboxAttempted?: boolean;
} = {}): string {
  if (typeof options.command === "string" && options.hostBashStore) {
    try {
      const parsed = parseHostBashShellCommand(options.command);
      const approved = options.hostBashStore.getApprovedEntry(sanitizeHostBashId(parsed.command));
      if (approved?.enabled) return "Host Bash";
    } catch {
      // If the command is not eligible for Host Bash, fall back to the normal bash/sandbox label.
    }
  }
  return options.sandboxAttempted ? "Sandbox" : "bash";
}

export function resolveToolDisplayName(
  toolName: string,
  options: { result?: unknown; sandboxAttempted?: boolean } = {}
): string {
  if (toolName !== "bash") return toolName;
  const details = extractToolResultDetails(options.result);
  if (details) {
    if (details.hostBash === true) return "Host Bash";
    if (details.sandboxApplied === true) return "Sandbox";
    if (typeof details.sandboxWarning === "string" && details.sandboxWarning.includes("host bash fallback")) return "Host Bash";
    if (typeof details.sandboxWarning === "string" && details.sandboxWarning) return "Sandbox disabled";
    if (details.sandboxApplied === false) return toolName;
  }
  return options.sandboxAttempted ? "Sandbox" : toolName;
}

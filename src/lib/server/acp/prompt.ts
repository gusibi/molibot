import type { AcpPendingPermissionView } from "./types.js";

export function buildStructuredAcpTaskPrompt(prompt: string): string {
  return [
    prompt.trim(),
    "",
    "Output requirements:",
    "- Return the final answer in concise Markdown.",
    "- Use short sections when relevant: `## Summary`, `## Execution Context`, `## Changes`, `## Verification`, `## Notes`.",
    "- `## Execution Context` is mandatory. Include raw outputs (or explicit errors) for each command below:",
    "  - `pwd`",
    "  - `ls -la`",
    "  - `command -v python || command -v python3`",
    "  - `python -V || python3 -V`",
    "  - `command -v uv || true`",
    "  - `echo \"DATABASE_URL=$DATABASE_URL\"`",
    "  - `echo \"DB_PATH=$DB_PATH\"`",
    "- If the task runs a script or command, print the exact command and exit code.",
    "- Prefer bullet lists over long unbroken paragraphs.",
    "- When mentioning files, wrap paths in backticks.",
    "- In `## Changes`, use bullets like `- `path/to/file`: what changed`.",
    "- In `## Verification`, list commands or checks and whether they passed or could not run.",
    "- If something is blocked, say exactly what is blocked and what still needs manual verification."
  ].join("\n");
}

export function buildAcpPermissionText(permission: AcpPendingPermissionView): string {
  const lines = [
    "ACP permission request:",
    `Request: ${permission.id}`,
    `Title: ${permission.title}`,
    `Kind: ${permission.kind}`
  ];
  if (permission.inputPreview) {
    lines.push(`Input: ${permission.inputPreview}`);
  }
  if (permission.options.length > 0) {
    lines.push("Options:");
    for (const option of permission.options) {
      const details = [option.name, option.kind, option.description].filter(Boolean).join(" | ");
      lines.push(`- ${option.optionId}${details ? `: ${details}` : ""}`);
    }
    lines.push(`Approve: /approve ${permission.id} <optionId>`);
    lines.push(`Deny: /deny ${permission.id}`);
  }
  return lines.join("\n");
}

export function buildAcpHelpText(): string {
  return [
    "ACP commands:",
    "The same `/acp ...` control commands work for Codex, Claude Code, and custom ACP targets.",
    "When an ACP session is active, non-ACP messages are proxied directly to that ACP session by default.",
    "Provider-specific remote commands are shown in `/acp status` with prefixes such as `codex:/...` or `claude-code:/...`.",
    "/acp help - show ACP command help",
    "/acp targets - list configured ACP targets",
    "/acp projects - list registered ACP projects",
    "/acp sessions - list available ACP sessions for current target/project",
    "/acp add-project <id> <absolute-path> - register/update a project",
    "/acp remove-project <id> - remove a registered project",
    "/acp new <targetId> <projectId> [manual|auto-safe|auto-all] - open a coding session",
    "/acp status - show current ACP session",
    "/acp remote <command> [args] - run a provider remote command",
    "/acp mode <manual|auto-safe|auto-all> - change approval mode",
    "/acp task <instructions> - send a coding task to the active ACP session",
    "/acp stop - stop the running ACP task immediately",
    "/acp cancel - cancel the running ACP task",
    "/acp close - close the ACP session",
    "/approve <requestId> <optionId> - approve a pending ACP request",
    "/deny <requestId> - reject or cancel a pending ACP request"
  ].join("\n");
}

import { basename, resolve } from "node:path";
import type { ToolExecutionMode } from "@mariozechner/pi-agent-core";
import type { BeforeToolCallContext } from "@mariozechner/pi-agent-core";
import { config } from "../app/env.js";
import { resolveAuthFilePath } from "./auth.js";
import { resolveToolPath } from "./tools/path.js";

const SERIALIZED_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "write",
  "switchModel",
  "profileFiles",
  "loadMcp",
  "createEvent",
  "attach",
  "subagent",
  "publishHtml"
]);

const SERIALIZED_MEMORY_ACTIONS = new Set(["add", "update", "delete", "flush", "sync", "compact"]);

const DESTRUCTIVE_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|[;&\n\s])rm\s+-rf\s+\/($|[\s;&\n])/i,
    reason: "Refusing to run a command that recursively deletes the filesystem root."
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Refusing to discard local changes with `git reset --hard`."
  },
  {
    pattern: /\bgit\s+checkout\s+--\s+/i,
    reason: "Refusing to overwrite files with `git checkout --`."
  },
  {
    pattern: /\bgit\s+clean\b[^\n]*\s-f/i,
    reason: "Refusing to remove untracked files with `git clean -f`."
  },
  {
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: "Refusing to stop or reboot the host from the agent."
  },
  {
    pattern: /\bmkfs(?:\.[a-z0-9]+)?\b/i,
    reason: "Refusing to run filesystem formatting commands."
  },
  {
    pattern: /\bdd\s+if=/i,
    reason: "Refusing to run raw block-copy commands like `dd if=`."
  },
  {
    pattern: /:\(\)\s*\{/,
    reason: "Refusing to run fork-bomb shell syntax."
  }
];

function matchesReminderIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /提醒|remind|待办|todo|稍后|明天|下周|later/.test(text) ||
    /\b(in\s+\d+\s+(minute|minutes|hour|hours|day|days)|tomorrow|next week)\b/.test(normalized)
  );
}

function normalizePathKey(pathLike: string): string {
  const resolved = resolve(pathLike);
  return process.platform === "darwin" || process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function protectedPathReason(resolvedPath: string, workspaceDir: string): string | null {
  const candidates = [
    config.settingsFile,
    resolveAuthFilePath(),
    resolve(workspaceDir, ".env"),
    resolve(workspaceDir, ".env.local")
  ].map(normalizePathKey);
  const normalized = normalizePathKey(resolvedPath);
  if (candidates.includes(normalized)) {
    return "Direct edits to runtime settings, auth, or local secret env files are blocked. Use the dedicated settings/auth flows instead.";
  }

  const name = basename(resolvedPath).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) {
    return "Direct edits to env secret files are blocked. Update secrets through controlled config instead.";
  }

  return null;
}

function validateBashCommand(command: string): string | null {
  for (const row of DESTRUCTIVE_BASH_PATTERNS) {
    if (row.pattern.test(command)) return row.reason;
  }
  return null;
}

export function shouldSerializeToolCall(toolName: string, args: unknown): boolean {
  if (SERIALIZED_TOOL_NAMES.has(toolName)) return true;
  if (toolName === "memory") {
    const action = String((args as { action?: unknown })?.action ?? "").trim().toLowerCase();
    return SERIALIZED_MEMORY_ACTIONS.has(action);
  }
  return false;
}

export function getPreferredToolExecutionMode(): ToolExecutionMode {
  return "parallel";
}

export function validateToolCallPreflight(
  context: BeforeToolCallContext,
  options: { cwd: string; workspaceDir: string }
): string | null {
  const toolName = context.toolCall.name;
  const args = context.args as Record<string, unknown>;

  if (toolName === "bash") {
    const command = String(args.command ?? "");
    return validateBashCommand(command);
  }

  if (toolName === "write" || toolName === "edit") {
    const rawPath = String(args.path ?? "").trim();
    if (!rawPath) return "File path is required.";
    const resolvedPath = resolveToolPath(options.cwd, rawPath);
    return protectedPathReason(resolvedPath, options.workspaceDir);
  }

  if (toolName === "memory") {
    const action = String(args.action ?? "").trim().toLowerCase();
    if ((action === "add" || action === "update") && typeof args.content === "string" && matchesReminderIntent(args.content)) {
      return "Scheduling or reminder-like content should use toolSearch to load createEvent, not memory.";
    }
  }

  return null;
}

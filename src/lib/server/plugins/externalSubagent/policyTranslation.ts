import type { PermissionMode } from "$lib/server/agent/permissions/decidePermission.js";
import type { ClaudeCodePermissionMode, CodexPermissionMode } from "#external-subagent";

/**
 * Translates the session's effective execution policy into the external
 * coding-agent runtime options each adapter supports. The parent task's
 * permissions win over any provider-side preference; where an adapter cannot
 * honor the mode, this reports the unsupported capability instead of silently
 * waiting for approvals nobody can give or broadening a restricted mode.
 */

export function translatePolicyForClaudeCode(mode: PermissionMode): ClaudeCodePermissionMode {
  switch (mode) {
    case "plan":
      return "plan";
    case "accept_edits":
      return "acceptEdits";
    case "auto":
      return "bypassPermissions";
    case "manual":
      throw new Error(
        "Manual mode requires interactive approval, which the external Claude Code adapter cannot honor. Run this task in Accept Edits or Full Access, or use an internal subagent."
      );
  }
}

export function translatePolicyForCodex(mode: PermissionMode): CodexPermissionMode {
  switch (mode) {
    case "accept_edits":
      return "approve-for-me";
    case "auto":
      return "dangerously-bypass-approvals-and-sandbox";
    case "plan":
      throw new Error(
        "Plan mode is read-only, which the external Codex adapter cannot honor: it exposes no read-only execution mode. Use an internal subagent for delegated planning."
      );
    case "manual":
      throw new Error(
        "Manual mode requires interactive approval, which the external Codex adapter cannot honor. Run this task in Accept Edits or Full Access, or use an internal subagent."
      );
  }
}

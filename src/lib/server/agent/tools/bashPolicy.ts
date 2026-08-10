import { findApprovedHostBash, tryParseHostBashCommand } from "$lib/server/agent/tools/bash.js";
import { decidePermission, type PermissionMode } from "$lib/server/agent/permissions/decidePermission.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import type { PolicyDecision, ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";

interface FileToolRedirectRule {
  pattern: RegExp;
  message: string;
}

// Commands whose only purpose is reading/writing/editing a file must go through
// the dedicated read/write/edit tools (which enforce path guards and structured
// truncation). Compound usage (pipes, redirects into other commands, globs in
// scripts) is intentionally left alone.
const FILE_TOOL_REDIRECT_RULES: FileToolRedirectRule[] = [
  {
    // Standalone file dump: `cat file`, `head -n 5 file`, `tail -100 file`, `less file`
    // — no pipes, no redirects, no multiple commands.
    pattern: /^\s*(cat|head|tail|less|more)\s+(-[\w+-]+\s+)*[^|;&<>]+$/,
    message: "Use the read tool to read files (supports offset/limit for large files) instead of shell readers."
  },
  {
    // Writing file content via redirection: `echo ... > file`, `printf ... >> file`,
    // `cat > file`, `cat <<EOF > file`, `tee file`.
    pattern: /^\s*(echo|printf)\b[^|;&]*>{1,2}\s*\S+\s*$|^\s*cat\s*(<<\s*['"]?\w+['"]?)?\s*>{1,2}\s*\S+|^\s*(echo|printf|cat)\b[^|;&]*\|\s*tee\b/,
    message: "Use the write tool to create files and the edit tool to modify them, instead of shell redirection/heredocs."
  },
  {
    // In-place editing: `sed -i`, `perl -i`, `awk -i inplace`.
    pattern: /^\s*sed\b[^|;&]*\s-i|^\s*perl\b[^|;&]*\s-i|^\s*g?awk\b[^|;&]*-i\s*inplace/,
    message: "Use the edit tool to modify files instead of in-place stream editors (sed -i / perl -i / awk -i)."
  }
];

export function findFileToolRedirect(command: string): string | null {
  const trimmed = command.trim();
  for (const rule of FILE_TOOL_REDIRECT_RULES) {
    if (rule.pattern.test(trimmed)) return rule.message;
  }
  return null;
}

/**
 * Where this bash call's side effects are actually fenced.
 *
 * This is the *containment* axis, and it is deliberately separate from "do we
 * ask the user" (the mode axis). Keeping them apart is what stops turning the
 * sandbox off from silently meaning "never ask again" — the Bypass mode the
 * PRD refuses to ship.
 */
export type BashContainment =
  /** Runs inside the tool sandbox. */
  | "sandboxed"
  /** Escapes to the host, and an approved Host Bash grant already covers it. */
  | "host_granted"
  /** Would run on the host with no grant. */
  | "host";

export function resolveBashContainment(options: {
  sandboxEnabled: boolean;
  hasApprovedHostGrant: boolean;
}): BashContainment {
  if (options.hasApprovedHostGrant) return "host_granted";
  return options.sandboxEnabled ? "sandboxed" : "host";
}

export function decideBashToolPolicy(options: {
  tool: ToolDefinition;
  input: unknown;
  ctx: ToolExecutionContext;
  sandboxEnabled: boolean;
  hostBashStore?: ReturnType<typeof getHostBashStore>;
  /**
   * The session's permission mode. Optional so a caller that predates modes
   * keeps the previous behaviour (always allow) rather than silently becoming
   * stricter; `tools/index.ts` always supplies it.
   */
  permissionMode?: PermissionMode;
  /** Builds the approval request when the mode says to ask. */
  buildApprovalRequest?: () => ApprovalRequest;
}): PolicyDecision {
  const params = options.input as { command?: string; hostApproval?: any };

  const redirect = findFileToolRedirect(params?.command ?? "");
  if (redirect) {
    return { type: "deny", reason: redirect };
  }

  const parsed = tryParseHostBashCommand(params?.command ?? "");
  const approved = findApprovedHostBash(options.hostBashStore ?? getHostBashStore(), parsed);

  if (approved) {
    // An owner-scoped grant already covers this exact command; asking again
    // would charge the user twice for one decision.
    return { type: "allow" };
  }

  const containment = resolveBashContainment({
    sandboxEnabled: options.sandboxEnabled,
    hasApprovedHostGrant: false
  });

  // Without a mode this is a caller from before permission modes existed; keep
  // its previous behaviour rather than tightening silently.
  if (!options.permissionMode) return { type: "allow" };

  const decision = decidePermission({
    mode: options.permissionMode,
    effect: "execute",
    containment
  });

  if (decision === "deny") {
    return {
      type: "deny",
      reason: "Plan mode is read-only: bash cannot run until you exit Plan."
    };
  }

  // `ask` on a HOST command is deliberately still `allow` here: the bash
  // handler owns that conversation. It blocks on the Host Bash approval store
  // and executes inline once approved, so gating here as well would make the
  // user approve the same command twice — once for the broker request, once
  // for the Host Bash record. That is the double-prompt this branch has always
  // existed to prevent.
  //
  // A *sandboxed* command has no such second conversation, so an `ask` there
  // has to be honoured here or Manual would silently not apply to bash at all.
  if (decision === "ask" && containment === "sandboxed" && options.buildApprovalRequest) {
    return { type: "approval_required", request: options.buildApprovalRequest() };
  }

  return { type: "allow" };
}


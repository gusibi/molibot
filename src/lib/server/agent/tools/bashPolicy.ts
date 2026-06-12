import { findApprovedHostBash, tryParseHostBashCommand } from "$lib/server/agent/tools/bash.js";
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

export function decideBashToolPolicy(options: {
  tool: ToolDefinition;
  input: unknown;
  ctx: ToolExecutionContext;
  sandboxEnabled: boolean;
  hostBashStore?: ReturnType<typeof getHostBashStore>;
}): PolicyDecision {
  const params = options.input as { command?: string; hostApproval?: any };

  const redirect = findFileToolRedirect(params?.command ?? "");
  if (redirect) {
    return { type: "deny", reason: redirect };
  }

  const parsed = tryParseHostBashCommand(params?.command ?? "");
  const approved = findApprovedHostBash(options.hostBashStore ?? getHostBashStore(), parsed);
  if (approved) {
    return { type: "allow" };
  }

  if (!options.sandboxEnabled) {
    return { type: "allow" };
  }

  // Host approval requests are gated inside the bash tool handler itself, which
  // blocks on the Host Bash approval store and executes inline once approved.
  // Gating them here too would force the user to approve the same command twice
  // (once for the broker request, once for the Host Bash record).
  return { type: "allow" };
}


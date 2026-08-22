import type { BuiltInFeaturePlugin } from "$lib/server/plugins/types.js";
import { resolveExternalSubagentConfig } from "./config.js";

/**
 * External Subagent Feature Plugin adaptor (issue #34).
 * Configuration is now owned by the plugin package under `config/external-subagent/`.
 */
export const externalSubagentFeaturePlugin: BuiltInFeaturePlugin = {
  key: "external-subagent",
  settingsKey: "entries",
  name: "External Subagent",
  version: "built-in",
  description: "Run standalone OpenAI Codex and Claude Code agents as isolated external subagents.",
  isEnabled: (settings) => resolveExternalSubagentConfig(settings).enabled,
  buildPromptSection: (settings) => {
    const plugin = resolveExternalSubagentConfig(settings);
    if (!plugin.enabled) return null;

    const activeRoles: string[] = [];
    const activeRoleIds: string[] = [];
    if (plugin.claudeCodeEnabled) {
      activeRoles.push("`claude-code` (Claude Code — multi-file refactoring, test-driven bug fixing, deep debugging)");
      activeRoleIds.push("claude-code");
    }
    if (plugin.codexEnabled) {
      activeRoles.push("`codex` (OpenAI Codex — feature generation, standalone scripts, algorithm implementations)");
      activeRoleIds.push("codex");
    }

    if (activeRoles.length === 0) return null;

    return [
      "## Installed Feature Plugin: External Coding Subagents",
      "- External subagent roles are directly integrated into the `subagent` tool:",
      ...activeRoles.map((role) => `  - ${role}`),
      `- Call an enabled role via \`subagent({ agent: '${activeRoleIds[0]}', task: '...' })\`.`,
      "- External subagents run in isolated child processes and DO NOT see parent chat history; your `task` parameter MUST be completely self-contained (include specific file paths, goals, constraints, and how to verify).",
      `- You can chain an enabled role with internal roles, e.g. \`subagent({ chain: [{ agent: 'scout', task: '...' }, { agent: '${activeRoleIds[0]}', task: '...' }, { agent: 'reviewer', task: '...' }] })\`.`
    ].join("\n");
  },
  createTools: () => []
};

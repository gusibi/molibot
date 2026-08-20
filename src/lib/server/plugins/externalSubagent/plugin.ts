import type { BuiltInFeaturePlugin, PluginSettingField } from "$lib/server/plugins/types.js";
import {
  createClaudeCodeSubagentTool,
  createCodexSubagentTool
} from "./tools.js";

const externalSubagentSettingsFields: PluginSettingField[] = [
  {
    key: "enabled",
    label: "Enable External Subagents",
    type: "boolean",
    defaultValue: false,
    description: "Enable running OpenAI Codex and Claude Code as standalone external subagents."
  },
  {
    key: "codexEnabled",
    label: "Enable Codex Subagent",
    type: "boolean",
    defaultValue: true,
    description: "Allow delegating tasks to OpenAI Codex via codexSubagent tool."
  },
  {
    key: "codexPermissionMode",
    label: "Codex permission mode",
    type: "select",
    defaultValue: "never",
    description: "Approval policy for Codex unattended execution.",
    options: [
      { value: "never", label: "Never ask (safe default)" },
      { value: "approve-for-me", label: "Approve for me (auto review)" },
      { value: "dangerously-bypass-approvals-and-sandbox", label: "Dangerously bypass approvals and sandbox (full access)" }
    ]
  },
  {
    key: "codexPath",
    label: "Codex CLI / package path",
    type: "text",
    placeholder: "Auto-detected from PATH or ~/.molibot/runtimes",
    description: "Optional custom path to Codex executable or @openai/codex package."
  },
  {
    key: "claudeCodeEnabled",
    label: "Enable Claude Code Subagent",
    type: "boolean",
    defaultValue: true,
    description: "Allow delegating tasks to Claude Code via claudeCodeSubagent tool."
  },
  {
    key: "claudeCodePermissionMode",
    label: "Claude Code permission mode",
    type: "select",
    defaultValue: "dontAsk",
    description: "Approval policy for Claude Code unattended execution.",
    options: [
      { value: "dontAsk", label: "Don't ask (safe default)" },
      { value: "acceptEdits", label: "Accept edits" },
      { value: "auto", label: "Auto" },
      { value: "plan", label: "Plan mode" },
      { value: "bypassPermissions", label: "Bypass permissions (full access)" }
    ]
  },
  {
    key: "claudeCodePath",
    label: "Claude Code CLI / SDK path",
    type: "text",
    placeholder: "Auto-detected from PATH or ~/.molibot/runtimes",
    description: "Optional custom path to Claude CLI or @anthropic-ai/claude-agent-sdk package."
  }
];

export const externalSubagentFeaturePlugin: BuiltInFeaturePlugin = {
  key: "external-subagent",
  name: "External Subagent",
  version: "built-in",
  description: "Run standalone OpenAI Codex and Claude Code agents as isolated external subagents.",
  settingsKey: "externalSubagent",
  settingsFields: externalSubagentSettingsFields,
  isEnabled: (settings) => Boolean(settings.plugins.externalSubagent?.enabled),
  buildPromptSection: (settings) => {
    const plugin = settings.plugins.externalSubagent;
    if (!plugin?.enabled) return null;

    const activeRoles: string[] = [];
    if (plugin.claudeCodeEnabled !== false) {
      activeRoles.push("`claude-code` (Claude Code — multi-file refactoring, test-driven bug fixing, deep debugging)");
    }
    if (plugin.codexEnabled !== false) {
      activeRoles.push("`codex` (OpenAI Codex — feature generation, standalone scripts, algorithm implementations)");
    }

    if (activeRoles.length === 0) return null;

    return [
      "## Installed Feature Plugin: External Coding Subagents",
      "- External subagent roles are directly integrated into the `subagent` tool:",
      ...activeRoles.map((role) => `  - ${role}`),
      "- Call them via `subagent({ agent: 'claude-code', task: '...' })` or `subagent({ agent: 'codex', task: '...' })`.",
      "- External subagents run in isolated child processes and DO NOT see parent chat history; your `task` parameter MUST be completely self-contained (include specific file paths, goals, constraints, and how to verify).",
      "- You can chain them with internal roles, e.g. `subagent({ chain: [{ agent: 'scout', task: '...' }, { agent: 'claude-code', task: '...' }, { agent: 'reviewer', task: '...' }] })`."
    ].join("\n");
  },
  createTools: () => []
};

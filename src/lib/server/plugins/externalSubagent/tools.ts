import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { ExternalSubagentRuntime } from "#external-subagent";
import { assertExternalSubagentProviderEnabled, resolveExternalSubagentConfig } from "./config.js";
import type { FeaturePluginContext } from "$lib/server/plugins/types.js";
import { pluginDataDir } from "$lib/server/plugins/contract/paths.js";

const taskSchema = Type.Object({
  task: Type.String({
    description: "The complete, self-contained instruction for the external subagent. Include all necessary file paths and context."
  })
});

const sharedRuntime = new ExternalSubagentRuntime({
  runtimesDir: pluginDataDir("external-subagent") ?? undefined
});

/**
 * The one runtime the subagent tools execute through. Availability probes must
 * reuse this exact instance (pitfall 21: a liveness probe must exercise the
 * real runtime) so a passing probe means the tool path works.
 */
export function getExternalSubagentSharedRuntime(): ExternalSubagentRuntime {
  return sharedRuntime;
}

export function createCodexSubagentTool(context: FeaturePluginContext): AgentTool<typeof taskSchema> {
  const tool: AgentTool<typeof taskSchema> = {
    name: "codexSubagent",
    label: "Codex Subagent",
    description:
      "Delegate a standalone coding, implementation, or targeted refactoring task to OpenAI Codex in an isolated process. Ideal for: building new feature modules, standalone scripts, algorithm implementations, and targeted code transforms. The subagent runs in the current workspace directory and does not see parent conversation history.",
    parameters: taskSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const settings = context.getSettings();
      const pluginSettings = resolveExternalSubagentConfig(settings);
      assertExternalSubagentProviderEnabled(pluginSettings, "codex");
      const permissionMode = pluginSettings.codexPermissionMode;
      const customPath = pluginSettings.codexPath;

      const result = await sharedRuntime.run("codex", {
        task: params.task,
        cwd: context.cwd,
        signal,
        timeoutMs: 600_000,
        permissionMode,
        customPath
      });

      const responseText =
        result.output.trim().length > 0
          ? result.output
          : result.diagnostic
            ? `Codex execution ended with no output. Diagnostic: ${result.diagnostic}`
            : "Codex subagent finished with no output.";

      return {
        content: [{ type: "text", text: responseText }],
        details: {
          provider: result.provider,
          stopReason: result.stopReason,
          durationMs: result.durationMs,
          diagnostic: result.diagnostic
        }
      };
    }
  };

  // Declare tool risk classification
  (tool as any).classification = {
    risk: "high",
    source: "plugin",
    effect: "execute"
  };

  return tool;
}

export function createClaudeCodeSubagentTool(context: FeaturePluginContext): AgentTool<typeof taskSchema> {
  const tool: AgentTool<typeof taskSchema> = {
    name: "claudeCodeSubagent",
    label: "Claude Code Subagent",
    description:
      "Delegate complex software engineering tasks to Claude Code in an isolated process. Ideal for: multi-file codebase refactoring, debugging difficult issues, test-driven bug fixing, and deep codebase investigation. The subagent runs in the current workspace directory and does not see parent conversation history.",
    parameters: taskSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const settings = context.getSettings();
      const pluginSettings = resolveExternalSubagentConfig(settings);
      assertExternalSubagentProviderEnabled(pluginSettings, "claude-code");
      const permissionMode = pluginSettings.claudeCodePermissionMode;
      const customPath = pluginSettings.claudeCodePath;

      const result = await sharedRuntime.run("claude-code", {
        task: params.task,
        cwd: context.cwd,
        signal,
        timeoutMs: 600_000,
        permissionMode,
        customPath
      });

      const responseText =
        result.output.trim().length > 0
          ? result.output
          : result.diagnostic
            ? `Claude Code execution ended with no output. Diagnostic: ${result.diagnostic}`
            : "Claude Code subagent finished with no output.";

      return {
        content: [{ type: "text", text: responseText }],
        details: {
          provider: result.provider,
          stopReason: result.stopReason,
          durationMs: result.durationMs,
          diagnostic: result.diagnostic
        }
      };
    }
  };

  // Declare tool risk classification
  (tool as any).classification = {
    risk: "high",
    source: "plugin",
    effect: "execute"
  };

  return tool;
}

import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { externalSubagentFeaturePlugin } from "./plugin.js";
import { createClaudeCodeSubagentTool, createCodexSubagentTool } from "./tools.js";

test("createCodexSubagentTool declares high risk, plugin source, execute effect", () => {
  const context = {
    getSettings: () => defaultRuntimeSettings,
    cwd: process.cwd(),
    workspaceDir: process.cwd()
  };
  const tool = createCodexSubagentTool(context);
  assert.equal(tool.name, "codexSubagent");
  assert.deepEqual((tool as any).classification, {
    risk: "high",
    source: "plugin",
    effect: "execute"
  });
});

test("createClaudeCodeSubagentTool declares high risk, plugin source, execute effect", () => {
  const context = {
    getSettings: () => defaultRuntimeSettings,
    cwd: process.cwd(),
    workspaceDir: process.cwd()
  };
  const tool = createClaudeCodeSubagentTool(context);
  assert.equal(tool.name, "claudeCodeSubagent");
  assert.deepEqual((tool as any).classification, {
    risk: "high",
    source: "plugin",
    effect: "execute"
  });
});

test("externalSubagentFeaturePlugin isEnabled and createTools respect plugin configuration", () => {
  const disabledSettings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    plugins: {
      ...defaultRuntimeSettings.plugins,
      externalSubagent: {
        enabled: false,
        codexEnabled: true,
        codexPermissionMode: "never",
        claudeCodeEnabled: true,
        claudeCodePermissionMode: "dontAsk"
      }
    }
  };

  assert.equal(externalSubagentFeaturePlugin.isEnabled(disabledSettings), false);
  assert.equal(externalSubagentFeaturePlugin.buildPromptSection?.(disabledSettings), null);

  const contextDisabled = {
    getSettings: () => disabledSettings,
    cwd: process.cwd(),
    workspaceDir: process.cwd()
  };
  assert.deepEqual(externalSubagentFeaturePlugin.createTools?.(contextDisabled), []);

  const enabledSettings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    plugins: {
      ...defaultRuntimeSettings.plugins,
      externalSubagent: {
        enabled: true,
        codexEnabled: true,
        codexPermissionMode: "never",
        claudeCodeEnabled: false,
        claudeCodePermissionMode: "dontAsk"
      }
    }
  };

  assert.equal(externalSubagentFeaturePlugin.isEnabled(enabledSettings), true);
  const prompt = externalSubagentFeaturePlugin.buildPromptSection?.(enabledSettings);
  assert.ok(prompt?.includes("`codex`"));
  assert.ok(!prompt?.includes("`claude-code`"));

  const contextEnabled = {
    getSettings: () => enabledSettings,
    cwd: process.cwd(),
    workspaceDir: process.cwd()
  };
  const tools = externalSubagentFeaturePlugin.createTools?.(contextEnabled) ?? [];
  assert.equal(tools.length, 0);
});

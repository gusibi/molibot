import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getPluginConfigStore, resetPluginConfigStoreForTests } from "$lib/server/plugins/contract/configStore.js";
import { externalSubagentFeaturePlugin } from "./plugin.js";
import {
  createClaudeCodeSubagentTool,
  createCodexSubagentTool
} from "./tools.js";
import type { FeaturePluginContext } from "$lib/server/plugins/types.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

test("externalSubagent tools are defined with high risk execution metadata", () => {
  const context: FeaturePluginContext = {
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

test("externalSubagentFeaturePlugin isEnabled and buildPromptSection respect plugin configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-ext-tools-test-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsConfigDir = path.join(root, "config");
    resetPluginConfigStoreForTests();

    const configStore = getPluginConfigStore();
    await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: true,
      claudeCodeEnabled: false
    });

    const disabledSettings: RuntimeSettings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "external-subagent": { enabled: false }
        }
      }
    };

    assert.equal(externalSubagentFeaturePlugin.isEnabled(disabledSettings), false);
    assert.equal(externalSubagentFeaturePlugin.buildPromptSection?.(disabledSettings), null);

    const enabledSettings: RuntimeSettings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "external-subagent": { enabled: true }
        }
      }
    };

    assert.equal(externalSubagentFeaturePlugin.isEnabled(enabledSettings), true);
    const prompt = externalSubagentFeaturePlugin.buildPromptSection?.(enabledSettings);
    assert.notEqual(prompt, null);
    assert.match(prompt ?? "", /`codex`/);
    assert.doesNotMatch(prompt ?? "", /claude-code/);
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

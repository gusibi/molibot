import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  injectExplicitSkillInvocationContext,
  mapUnsupportedDeveloperRole
} from "$lib/server/agent/core/runnerHelpers.js";

test("explicit Skill invocation persists as a readable Markdown reference without inline control blocks", () => {
  const rendered = injectExplicitSkillInvocationContext(
    "/diagnosing-bugs 修复这个问题",
    [{
      name: "diagnosing-bugs",
      scope: "global",
      filePath: "/workspace/.agents/skills/diagnosing-bugs/SKILL.md",
      baseDir: "/workspace/.agents/skills/diagnosing-bugs",
      aliases: []
    }]
  );

  assert.equal(
    rendered,
    "[$diagnosing-bugs](/workspace/.agents/skills/diagnosing-bugs/SKILL.md) 修复这个问题"
  );
  assert.doesNotMatch(rendered, /\[explicit skill invocation\]|content:\s*\|/);
});

test("unsupported developer role keeps system instructions out of the message transcript", () => {
  const settings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-test",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-test|test-model"
    },
    customProviders: [{
      id: "custom-test",
      name: "Custom Test",
      enabled: true,
      protocol: "openai-compatible" as const,
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      path: "/chat/completions",
      defaultModel: "test-model",
      models: [{
        id: "test-model",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };
  const context = {
    systemPrompt: "Base instructions",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: []
  };

  const mapped = mapUnsupportedDeveloperRole(settings, context);

  assert.equal(mapped.systemPrompt, "Base instructions");
  assert.deepEqual(mapped.messages, context.messages);
  assert.equal(mapped.messages.some((message: { role?: string }) => message.role === "system"), false);
});

test("unsupported developer messages are folded into the top-level system prompt", () => {
  const settings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-test",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-test|test-model"
    },
    customProviders: [{
      id: "custom-test",
      name: "Custom Test",
      enabled: true,
      protocol: "openai-compatible" as const,
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      path: "/chat/completions",
      defaultModel: "test-model",
      models: [{
        id: "test-model",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }]
    }]
  };
  const context = {
    systemPrompt: "Base instructions",
    messages: [
      { role: "developer", content: "Turn instructions" },
      { role: "user", content: [{ type: "text", text: "hello" }] }
    ],
    tools: []
  };

  const mapped = mapUnsupportedDeveloperRole(settings, context);

  assert.equal(mapped.systemPrompt, "Base instructions\n\nTurn instructions");
  assert.deepEqual(mapped.messages, [context.messages[1]]);
});

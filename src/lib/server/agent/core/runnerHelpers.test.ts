import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  injectExplicitSkillInvocationContext,
  isContextOverflowError,
  isContextOverflowResponse,
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

test("provider-specific overflow wording is recognized, throttling wording is not", () => {
  // Wording the previous hand-rolled substring list missed entirely.
  assert.equal(isContextOverflowError("Range of input length should be [1, 129024]"), true);
  assert.equal(isContextOverflowError("Your request exceeded model token limit: 131072"), true);
  assert.equal(
    isContextOverflowError("Please reduce the length of the messages or completion"),
    true
  );
  assert.equal(isContextOverflowError("prompt is too long: 213462 tokens > 200000 maximum"), true);

  // Bedrock words throttling as "Too many tokens", which the old list treated as
  // overflow and would have answered with a pointless compaction. pi excludes it
  // by the "Throttling error:" prefix its Bedrock provider formats errors with.
  assert.equal(
    isContextOverflowError("Throttling error: Too many tokens, please wait before trying again."),
    false
  );
  assert.equal(isContextOverflowError("rate limit reached for this model"), false);
  assert.equal(isContextOverflowError("The model is overloaded, try again later"), false);
});

test("silent overflow is detected from usage when the provider reports no error", () => {
  // z.ai style: answers normally with an input that never fit the window.
  const silentStop = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
    usage: { input: 210000, output: 20, cacheRead: 0, cacheWrite: 0 }
  } as any;
  assert.equal(isContextOverflowResponse(silentStop, 200000), true);

  // MiMo style: input truncated to fill the window, no room left to generate.
  const lengthStop = {
    role: "assistant",
    content: [],
    stopReason: "length",
    usage: { input: 200000, output: 0, cacheRead: 0, cacheWrite: 0 }
  } as any;
  assert.equal(isContextOverflowResponse(lengthStop, 200000), true);

  // A normal answer well inside the window must not trigger compaction.
  const healthy = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
    usage: { input: 1200, output: 30, cacheRead: 0, cacheWrite: 0 }
  } as any;
  assert.equal(isContextOverflowResponse(healthy, 200000), false);
  assert.equal(isContextOverflowResponse(healthy, undefined), false);
  assert.equal(isContextOverflowResponse(undefined, 200000), false);
});

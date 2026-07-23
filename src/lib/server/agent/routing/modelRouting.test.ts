import assert from "node:assert/strict";
import test from "node:test";
import { convertMessages } from "@earendil-works/pi-ai/api/openai-completions";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import { resolveSttTarget } from "$lib/server/agent/routing/stt.js";
import { resolveVisionFallbackTarget } from "$lib/server/agent/routing/vision-fallback.js";
import {
  applyAgentModelRoutingOverride,
  applyTurnModelOverride,
  resolveCustomModel
} from "$lib/server/agent/routing/modelRouting.js";

function settingsWithProviders(patch: Partial<RuntimeSettings>): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    ...patch,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      ...(patch.modelRouting ?? {})
    },
    modelFallback: {
      ...defaultRuntimeSettings.modelFallback,
      ...(patch.modelFallback ?? {})
    },
    customProviders: patch.customProviders ?? []
  };
}

test("STT route ignores disabled providers", () => {
  const settings = settingsWithProviders({
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      sttModelKey: "custom|disabled-stt|stt-a"
    },
    customProviders: [
      {
        id: "disabled-stt",
        name: "Disabled STT",
        enabled: false,
        baseUrl: "https://stt.example/v1",
        apiKey: "stt-key",
        path: "/audio/transcriptions",
        defaultModel: "stt-a",
        models: [
          { id: "stt-a", enabled: true, tags: ["stt"], supportedRoles: ["system", "user", "assistant", "tool"] }
        ]
      }
    ]
  });

  assert.equal(resolveSttTarget(settings), null);
});

test("vision fallback route ignores disabled providers", () => {
  const settings = settingsWithProviders({
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      visionModelKey: "custom|disabled-vision|vision-a"
    },
    customProviders: [
      {
        id: "disabled-vision",
        name: "Disabled Vision",
        enabled: false,
        baseUrl: "https://vision.example/v1",
        apiKey: "vision-key",
        path: "/chat/completions",
        defaultModel: "vision-a",
        models: [
          { id: "vision-a", enabled: true, tags: ["vision"], supportedRoles: ["system", "user", "assistant", "tool"] }
        ]
      }
    ]
  });

  assert.equal(resolveVisionFallbackTarget(settings), null);
});

function settingsWithBoundAgent(agentModelRouting: RuntimeSettings["agents"][number]["modelRouting"]): RuntimeSettings {
  return settingsWithProviders({
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "pi|anthropic|global-text",
      visionModelKey: "pi|anthropic|global-vision",
      sttModelKey: "pi|openai|global-stt",
      subagentModelKey: "pi|anthropic|global-subagent"
    },
    agents: [{ id: "moli", name: "Moli", description: "", enabled: true, modelRouting: agentModelRouting }],
    channels: {
      telegram: {
        instances: [
          { id: "bot-1", name: "Bot 1", enabled: true, agentId: "moli", credentials: {}, allowedChatIds: [] }
        ]
      }
    }
  });
}

test("agent override replaces only the routes it sets, leaving others on global", () => {
  const settings = settingsWithBoundAgent({ textModelKey: "custom|p1|agent-text", sttModelKey: "custom|p1|agent-stt" });
  const merged = applyAgentModelRoutingOverride(settings, "telegram", "bot-1");

  assert.equal(merged.modelRouting.textModelKey, "custom|p1|agent-text");
  assert.equal(merged.modelRouting.sttModelKey, "custom|p1|agent-stt");
  // vision not overridden -> stays global; non-overridable route stays global
  assert.equal(merged.modelRouting.visionModelKey, "pi|anthropic|global-vision");
  assert.equal(merged.modelRouting.subagentModelKey, "pi|anthropic|global-subagent");
  // global settings object is not mutated
  assert.equal(settings.modelRouting.textModelKey, "pi|anthropic|global-text");
});

test("turn model override changes only text routing without mutating shared settings", () => {
  const settings = settingsWithProviders({ modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "pi|anthropic|global" } });
  const overridden = applyTurnModelOverride(settings, "custom|project|local");
  assert.equal(overridden.modelRouting.textModelKey, "custom|project|local");
  assert.equal(settings.modelRouting.textModelKey, "pi|anthropic|global");
  assert.equal(overridden.modelRouting.visionModelKey, settings.modelRouting.visionModelKey);
  assert.equal(applyTurnModelOverride(settings, ""), settings);
});

test("agent override is a pass-through when bot is unmapped or agent has no override", () => {
  const noOverride = settingsWithBoundAgent(undefined);
  assert.equal(applyAgentModelRoutingOverride(noOverride, "telegram", "bot-1"), noOverride);

  const mapped = settingsWithBoundAgent({ textModelKey: "custom|p1|agent-text" });
  // unknown botId -> no agent resolved -> same reference back
  assert.equal(applyAgentModelRoutingOverride(mapped, "telegram", "unknown-bot"), mapped);
});

test("custom model compat disables developer messages when the model role definition omits developer", () => {
  const provider: RuntimeSettings["customProviders"][number] = {
    id: "openai-compatible",
    name: "OpenAI compatible",
    enabled: true,
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    path: "/chat/completions",
    defaultModel: "system-only",
    supportsThinking: true,
    models: [
      {
        id: "system-only",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      }
    ]
  };

  assert.equal(resolveCustomModel(provider, "system-only").compat?.supportsDeveloperRole, false);
});

test("custom model compat enables developer messages only when the model role definition includes developer", () => {
  const provider: RuntimeSettings["customProviders"][number] = {
    id: "openai-compatible",
    name: "OpenAI compatible",
    enabled: true,
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    path: "/chat/completions",
    defaultModel: "developer-capable",
    supportsThinking: true,
    models: [
      {
        id: "developer-capable",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool", "developer"]
      }
    ]
  };

  assert.equal(resolveCustomModel(provider, "developer-capable").compat?.supportsDeveloperRole, true);
});

test("pi serializes the top-level prompt with the role declared by each custom model", () => {
  const provider: RuntimeSettings["customProviders"][number] = {
    id: "openai-compatible",
    name: "OpenAI compatible",
    enabled: true,
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    path: "/chat/completions",
    defaultModel: "system-only",
    supportsThinking: true,
    models: [
      {
        id: "system-only",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      },
      {
        id: "developer-capable",
        enabled: true,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool", "developer"]
      }
    ]
  };
  const context = { systemPrompt: "Follow the instructions.", messages: [] };
  const systemModel = resolveCustomModel(provider, "system-only");
  const developerModel = resolveCustomModel(provider, "developer-capable");

  assert.equal(convertMessages(systemModel, context, systemModel.compat as any)[0]?.role, "system");
  assert.equal(convertMessages(developerModel, context, developerModel.compat as any)[0]?.role, "developer");
});

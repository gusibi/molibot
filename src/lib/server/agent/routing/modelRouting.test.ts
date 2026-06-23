import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import { resolveSttTarget } from "$lib/server/agent/routing/stt.js";
import { resolveVisionFallbackTarget } from "$lib/server/agent/routing/vision-fallback.js";
import { applyAgentModelRoutingOverride } from "$lib/server/agent/routing/modelRouting.js";

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
          { id: "stt-a", tags: ["stt"], supportedRoles: ["system", "user", "assistant", "tool"] }
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
          { id: "vision-a", tags: ["vision"], supportedRoles: ["system", "user", "assistant", "tool"] }
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

test("agent override is a pass-through when bot is unmapped or agent has no override", () => {
  const noOverride = settingsWithBoundAgent(undefined);
  assert.equal(applyAgentModelRoutingOverride(noOverride, "telegram", "bot-1"), noOverride);

  const mapped = settingsWithBoundAgent({ textModelKey: "custom|p1|agent-text" });
  // unknown botId -> no agent resolved -> same reference back
  assert.equal(applyAgentModelRoutingOverride(mapped, "telegram", "unknown-bot"), mapped);
});

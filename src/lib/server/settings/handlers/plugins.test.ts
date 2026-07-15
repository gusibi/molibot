import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "../defaults.js";
import type { RuntimeSettings } from "../schema.js";
import { updatePluginsConfig } from "./plugins.js";

test("updatePluginsConfig preserves and applies the complete memory settings block", () => {
  let settings = structuredClone(defaultRuntimeSettings);
  const runtime = {
    getSettings: () => settings,
    updateSettings: (patch: Partial<RuntimeSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }
  };
  const dailyMaterials = {
    ...settings.plugins.memory.dailyMaterials,
    enabled: true,
    time: "22:45",
    projectId: "project-1"
  };

  updatePluginsConfig(runtime, {
    memory: {
      ...settings.plugins.memory,
      enabled: true,
      backend: "mory",
      embeddingProviderId: "embedding-provider",
      embeddingModel: "embedding-model",
      reflectionTime: "05:15",
      reflectionNotifications: false,
      reflectionNotificationTarget: { channel: "telegram", botId: "news", chatId: "-1001" },
      dailyMaterials
    }
  });

  assert.equal(settings.plugins.memory.embeddingProviderId, "embedding-provider");
  assert.equal(settings.plugins.memory.embeddingModel, "embedding-model");
  assert.equal(settings.plugins.memory.reflectionTime, "05:15");
  assert.equal(settings.plugins.memory.reflectionNotifications, false);
  assert.deepEqual(settings.plugins.memory.reflectionNotificationTarget, {
    channel: "telegram",
    botId: "news",
    chatId: "-1001"
  });
  assert.deepEqual(settings.plugins.memory.dailyMaterials, dailyMaterials);
});

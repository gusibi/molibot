import { resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import type { ChannelPlugin, ChannelPluginInstance } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { WebManager, type WebConfig } from "$lib/server/channels/web/runtime.js";

function listInstances(settings: RuntimeSettings): ChannelPluginInstance<WebConfig>[] {
  return (settings.channels.web?.instances ?? [])
    .filter((instance) => instance.enabled !== false)
    .map((instance) => ({
      id: instance.id,
      workspaceDir: resolve(config.webWorkspaceDir, "bots", instance.id),
      config: { id: instance.id }
    }));
}

export const webChannelPlugin: ChannelPlugin<WebConfig> = {
  key: "web",
  name: "Web",
  version: "built-in",
  description: "Built-in Web profile runtime for scheduled tasks and reminders.",
  listInstances,
  createManager: (instance, deps) =>
    new WebManager(deps.getSettings, deps.updateSettings, deps, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir
    })
};

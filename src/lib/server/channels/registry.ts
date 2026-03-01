import { type RuntimeSettings } from "../config.js";
import type { MemoryGateway } from "../memory/gateway.js";
import type { SessionStore } from "../services/sessionStore.js";
import { feishuChannelPlugin } from "../plugins/channels/feishu/index.js";
import { telegramChannelPlugin } from "../plugins/channels/telegram/index.js";

export interface ChannelManager {
  apply(config: unknown): void;
  stop(): void;
}

export interface ChannelRuntimeDeps {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  sessions: SessionStore;
  memory: MemoryGateway;
}

export interface ChannelPluginInstance<TConfig> {
  id: string;
  config: TConfig;
  workspaceDir: string;
}

export interface ChannelPlugin<TConfig> {
  key: string;
  name: string;
  version: string;
  description?: string;
  listInstances: (settings: RuntimeSettings) => ChannelPluginInstance<TConfig>[];
  createManager: (instance: ChannelPluginInstance<TConfig>, deps: ChannelRuntimeDeps) => ChannelManager;
}

export const builtInChannelPlugins: ChannelPlugin<any>[] = [
  telegramChannelPlugin,
  feishuChannelPlugin
];

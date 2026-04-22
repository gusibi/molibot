import { type RuntimeSettings } from "../settings/index.js";
import type { MemoryGateway } from "../memory/gateway.js";
import type { SessionStore } from "../sessions/store.js";
import type { AiUsageTracker } from "../usage/tracker.js";
import type { ModelErrorTracker } from "../usage/modelErrorTracker.js";
import { feishuChannelPlugin } from "./feishu/index.js";
import { qqChannelPlugin } from "./qq/index.js";
import { telegramChannelPlugin } from "./telegram/index.js";
import { weixinChannelPlugin } from "./weixin/index.js";

export interface ChannelManager {
  apply(config: unknown): void;
  stop(): void;
  triggerTask?(event: unknown, filename: string): Promise<void>;
}

export interface ChannelRuntimeDeps {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  sessions: SessionStore;
  memory: MemoryGateway;
  usageTracker: AiUsageTracker;
  modelErrorTracker: ModelErrorTracker;
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
  feishuChannelPlugin,
  qqChannelPlugin,
  weixinChannelPlugin
];

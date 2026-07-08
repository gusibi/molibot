import { type RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import type { HookManager } from "$lib/server/agent/hooks/index.js";
import { feishuChannelPlugin } from "$lib/server/channels/feishu/index.js";
import { qqChannelPlugin } from "$lib/server/channels/qq/index.js";
import { telegramChannelPlugin } from "$lib/server/channels/telegram/index.js";
import { weixinChannelPlugin } from "$lib/server/channels/weixin/index.js";
import { webChannelPlugin } from "$lib/server/channels/web/index.js";

export interface ChannelManager {
  apply(config: unknown): void;
  stop(): void;
  stopTask?(scopeId: string): { aborted: boolean; clearedStale?: boolean };
  abortTaskRun?(scopeId: string, reason?: string): { aborted: boolean; clearedStale?: boolean };
  triggerTask?(event: unknown, filename: string): Promise<void>;
}

export interface ChannelRuntimeDeps {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  sessions: SessionStore;
  memory: MemoryGateway;
  usageTracker: AiUsageTracker;
  modelErrorTracker: ModelErrorTracker;
  hookManager: HookManager;
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
  webChannelPlugin,
  telegramChannelPlugin,
  feishuChannelPlugin,
  qqChannelPlugin,
  weixinChannelPlugin
];

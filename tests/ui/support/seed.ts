import { defaultRuntimeSettings } from '../../../src/lib/server/settings/defaults.js';
import { SettingsStore } from '../../../src/lib/server/settings/store.js';
import { storagePaths, ensureStorageDirs } from '../../../src/lib/server/infra/db/storage.js';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR;
const providerUrl = process.env.UI_TEST_PROVIDER_URL;
if (!dataDir || !providerUrl || !dataDir.includes('molibot-ui-') || storagePaths.dataDir !== resolve(dataDir)) {
  throw new Error('UI seed requires an isolated molibot-ui data directory and local Provider');
}
if (new URL(providerUrl).hostname !== '127.0.0.1') throw new Error('UI Provider must be loopback');
ensureStorageDirs();
const settings = structuredClone(defaultRuntimeSettings);
settings.providerMode = 'custom';
settings.defaultCustomProviderId = 'ui-test';
settings.customProviders = [{
  id: 'ui-test', name: 'UI Test', enabled: true, protocol: 'openai-compatible',
  baseUrl: providerUrl, apiKey: 'local-ui-test', path: '/chat/completions', defaultModel: 'fixture',
  models: [{ id: 'fixture', alias: 'UI Fixture', enabled: true, tags: ['text', 'tool'],
    supportedRoles: ['system', 'user', 'assistant', 'tool'], contextWindow: 128000 }]
}];
settings.modelRouting = { ...settings.modelRouting, textModelKey: 'custom|ui-test|fixture' };
settings.modelFallback.mode = 'off';
settings.defaultThinkingLevel = 'off';
settings.permissionMode = 'manual';
settings.agents = [
  { id: 'default', name: 'Momo', description: 'UI automation assistant', enabled: true, permissionMode: 'manual' },
  { id: 'ui-second', name: 'UI Second', description: 'Draft isolation assistant', enabled: true, permissionMode: 'manual' }
];
settings.defaultAgentId = 'default';
settings.channels = { web: { instances: [{ id: 'default', name: 'UI Web', enabled: true, agentId: 'default', credentials: {}, allowedChatIds: [] }] } };
settings.telegramBots = [];
settings.qqBots = [];
settings.mcpServers = [];
settings.openConnector.enabled = false;
settings.plugins.entries = {};
settings.plugins.memory.enabled = false;
settings.adaptiveThinking.enabled = false;
settings.desktopNavigation = { expandedAgentIds: ['default', 'ui-second'], page: 'agent-home', agentId: 'default' } as typeof settings.desktopNavigation;
new SettingsStore().save(settings);

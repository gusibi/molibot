import { resolve } from 'node:path';
import { defaultRuntimeSettings } from '../../../src/lib/server/settings/defaults.js';
import { SettingsStore } from '../../../src/lib/server/settings/store.js';
import { storagePaths, ensureStorageDirs, requiredStorageDirs } from '../../../src/lib/server/infra/db/storage.js';
import { assertIsolatedDataDir, assertLoopbackUrl, assertOutsideDir, isInsideDir } from './guard.js';

/**
 * Runs inside the whitelisted child environment and is the instance's own
 * isolation guard: it refuses to seed (so the service never starts) whenever a
 * resolved storage path could leave the throwaway data directory.
 */
const dataDir = process.env.DATA_DIR;
const providerUrl = process.env.UI_TEST_PROVIDER_URL;
const forbiddenDir = process.env.UI_TEST_FORBIDDEN_DIR;
if (!dataDir || !providerUrl || !forbiddenDir) {
  throw new Error('UI seed requires DATA_DIR, UI_TEST_PROVIDER_URL and UI_TEST_FORBIDDEN_DIR');
}
assertIsolatedDataDir(dataDir, 'UI');
assertLoopbackUrl(providerUrl, 'UI provider');
if (storagePaths.dataDir !== resolve(dataDir)) {
  throw new Error(`storage resolves to ${storagePaths.dataDir}, expected ${resolve(dataDir)}`);
}
const resolved = Object.fromEntries(requiredStorageDirs().map((dir, index) => [`dir#${index}`, dir]));
// path.resolve normalizes symlinked /var → /private/var; compare against the resolved root.
assertOutsideDir(resolved, forbiddenDir, 'UI seed');
for (const dir of requiredStorageDirs()) {
  if (!isInsideDir(dataDir, dir)) {
    throw new Error(`required storage dir ${dir} escapes DATA_DIR ${dataDir}`);
  }
}

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

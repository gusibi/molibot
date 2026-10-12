import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { getPiModels } from '../../src/lib/server/providers/piRuntime.js';
import { defaultRuntimeSettings } from '../../src/lib/server/settings/defaults.js';
import { MomRunner } from '../../src/lib/server/agent/core/runner.js';
import { MomRuntimeStore } from '../../src/lib/server/agent/session/store.js';
import { getTurnOrchestrator } from '../../src/lib/server/agent/core/turnOrchestrator.js';
import { inspectPiRecovery, pendingPiRecovery } from '../../src/lib/server/app/piRecovery.js';

const directory = process.env.DATA_DIR!;
const mode = process.env.PI_ORDINARY_FIXTURE_MODE;
const keepAlive = setInterval(() => {}, 1000);
const workspace = join(directory, 'moli-web', 'fixture');
mkdirSync(join(workspace, 'chat'), { recursive: true });
const settings = { ...defaultRuntimeSettings, providerMode: 'custom' as const, defaultCustomProviderId: 'fixture',
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: 'custom|fixture|fixture' },
  customProviders: [{ id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai-compatible' as const,
    baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', path: '/chat/completions', defaultModel: 'fixture',
    models: [{ id: 'fixture', enabled: true, tags: ['text'], supportedRoles: ['system', 'user', 'assistant', 'tool'] }] }] };
const events: unknown[] = [];
const runner = new MomRunner('web', 'chat', 'session', new MomRuntimeStore(workspace), () => settings, () => settings,
  { record: () => {} } as any, { record: () => {} } as any,
  { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: 'fixture', items: [] }),
    createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: 'fixture', query: '', promptText: '', selected: [], longTerm: [], daily: [] }) } as any,
  { emit: (stage: string, _ctx: unknown, payload: unknown) => events.push({ stage, payload }), flush: async () => {},
    transform: async (_stage: unknown, _ctx: unknown, value: unknown) => value, gate: async () => ({ type: 'allow' }) } as any);
const agent = (runner as any).agent;
const model = agent.state.model;
getPiModels().setProvider({ id: model.provider, name: 'Fixture', getModels: () => [model],
  auth: { apiKey: { name: 'fixture', resolve: async () => ({ auth: { apiKey: 'fixture-key' } }) } },
  stream: () => { throw new Error('Interrupt fixture must not submit through the provider'); },
  streamSimple: () => { throw new Error('Interrupt fixture must not submit through the provider'); } });
agent.streamFunction = (_model: unknown, _context: unknown, opts?: { signal?: AbortSignal }) => {
  appendFileSync(join(directory, 'ledger'), 'submit\n');
  const stream = createAssistantMessageEventStream();
  if (mode === 'interrupt') {
    // Pi commits the `request` checkpoint before this function runs, so the
    // parent's SIGKILL leaves a live model request without a committed result.
    process.send?.({ type: 'barrier' });
    opts?.signal?.addEventListener('abort', () => {
      const aborted: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], stopReason: 'aborted', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'error', reason: 'aborted', error: aborted }); stream.end();
    }, { once: true });
    return stream;
  }
  stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [{ type: 'text', text: 'Fixture answer' }], stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
  stream.end();
  return stream;
};
const context = { channel: 'web', workspaceDir: workspace, chatDir: join(workspace, 'chat'),
  message: { chatId: 'chat', sessionId: 'session', userId: 'actor', text: 'Do the work', messageId: 1,
    ts: '1', attachments: [], imageContents: [], chatType: 'private' as const },
  respond: async () => {}, replaceMessage: async () => {}, respondInThread: async () => {},
  setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} };
try {
  if (mode === 'interrupt') {
    await runner.run(context);
    throw new Error('Interrupted run must not complete inline');
  }
  const status = (id: string) => getTurnOrchestrator().getRunStatus(id);
  const inspected = await inspectPiRecovery(directory, status);
  const pending = await pendingPiRecovery(directory, status);
  if (inspected.length !== 1) throw new Error(`Expected one recovery owner, found ${inspected.length}`);
  clearInterval(keepAlive);
  process.send?.({ type: 'result', disposition: inspected[0].disposition, reason: inspected[0].reason, pending: pending.length });
  process.disconnect?.();
} catch (error) { clearInterval(keepAlive); process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; process.disconnect?.(); }

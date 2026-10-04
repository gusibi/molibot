import { buildTextChannelContext } from '../../src/lib/server/channels/shared/contextBuilder.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { getPiModels } from '../../src/lib/server/providers/piRuntime.js';
import { defaultRuntimeSettings } from '../../src/lib/server/settings/defaults.js';
import { MomRunner } from '../../src/lib/server/agent/core/runner.js';
import { MomRuntimeStore } from '../../src/lib/server/agent/session/store.js';
import { getTurnOrchestrator, SqliteTurnCleanupStore } from '../../src/lib/server/agent/core/turnOrchestrator.js';
import { pendingPiRecovery, resumePiOwner, piRecoveryChannelManager } from '../../src/lib/server/app/piRecovery.js';
import { SessionStore } from '../../src/lib/server/sessions/store.js';

const directory = process.env.DATA_DIR!;
const keepAlive = setInterval(() => {}, 1000);
const mode = process.env.PI_DEFERRED_FIXTURE_MODE;
const settings = { ...defaultRuntimeSettings, providerMode: 'custom' as const, defaultCustomProviderId: 'fixture',
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: 'custom|fixture|fixture' },
  customProviders: [{ id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai-compatible' as const,
    baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', path: '/chat/completions', defaultModel: 'fixture',
    models: [{ id: 'fixture', enabled: true, tags: ['text'], supportedRoles: ['system', 'user', 'assistant', 'tool'] }] }] };
const sourceChannel = process.env.PI_DEFERRED_FIXTURE_PROJECT;
const workspace = sourceChannel ? join(directory, 'projects', 'fixture', 'runtime') : join(directory, 'moli-web', 'fixture');
if (sourceChannel) mkdirSync(join(directory, 'project-root'), { recursive: true });
const sourceEvent = { chatId: '-100', scopeId: sourceChannel === 'telegram' ? '-100__topic_7' : 'original-chat:topic', messageThreadId: 7,
  sessionId: 'session', userId: 'actor', text: 'Answer async', messageId: 1, ts: '1', attachments: [], imageContents: [], chatType: 'private' as const };
const transport = sourceChannel ? buildTextChannelContext({ channel: sourceChannel as 'telegram' | 'feishu', event: sourceEvent,
  workspaceDir: join(directory, 'source-bot'), chatDir: join(directory, 'source-bot', 'chat'), store: {} as never, sessions: {} as never,
  instanceId: 'source-bot', activeSessionId: 'session', conversationKey: 'project-conversation',
  response: { sendText: async () => null }, createBotMessageId: () => 1 }).deliveryTarget : undefined;
const events: unknown[] = [];
const runner = new MomRunner('web', 'chat', 'session', new MomRuntimeStore(workspace), () => settings, () => settings,
  { record: () => {} } as any, { record: () => {} } as any,
  { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: 'fixture', items: [] }),
    createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: 'fixture', query: '', promptText: '', selected: [], longTerm: [], daily: [] }) } as any,
  { emit: (stage: string, _ctx: unknown, payload: unknown) => events.push({ stage, payload }), flush: async () => {},
    transform: async (_stage: unknown, _ctx: unknown, value: unknown) => value, gate: async () => ({ type: 'allow' }) } as any);
const agent = (runner as any).agent;
const model = agent.state.model;
if (mode === 'interrupt-gap') {
  const bind = agent.bindRun.bind(agent);
  agent.bindRun = (admission: any) => bind({ ...admission, onDeferred: async () => {} });
}
function answer(deferred: boolean) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
    content: deferred ? [] : [{ type: 'text', text: 'Original async answer' }], stopReason: deferred ? 'deferred' : 'stop',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    deferred: deferred ? { provider: model.provider, modelId: model.id, api: model.api, id: 'original-job', pollAfterMs: 1 } : undefined };
  stream.push({ type: 'done', reason: deferred ? 'deferred' : 'stop', message }); stream.end(); return stream;
}
agent.streamFunction = () => { appendFileSync(join(directory, 'ledger'), 'submit\n'); return answer(true); };
getPiModels().setProvider({ id: model.provider, name: 'Fixture', getModels: () => [model],
  auth: { apiKey: { name: 'fixture', resolve: async () => ({ auth: { apiKey: 'fixture-key' } }) } },
  stream: () => answer(true), streamSimple: () => answer(true),
  fetchDeferred: (_model, handle) => {
    appendFileSync(join(directory, 'ledger'), `poll:${handle.id}\n`);
    if (mode?.startsWith('interrupt')) { process.send?.({ type: 'barrier', handle }); return createAssistantMessageEventStream(); }
    return answer(false);
  } });
try {
  let result;
  if (mode?.startsWith('interrupt')) {
    result = await runner.run({ channel: sourceChannel ?? 'web', deliveryTarget: transport,
      project: sourceChannel ? { id: 'fixture-project', name: 'Fixture project', rootPath: join(directory, 'project-root'), scratchDir: join(workspace, 'scratch') } : undefined, workspaceDir: workspace, chatDir: join(workspace, 'chat'),
      message: { chatId: 'chat', sessionId: 'session', userId: 'actor', text: 'Answer async', messageId: 1,
        ts: '1', attachments: [], imageContents: [], chatType: 'private' },
      respond: async () => {}, replaceMessage: async () => {}, respondInThread: async () => {},
      setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} });
  } else {
    const orchestrator = getTurnOrchestrator();
    const pending = await pendingPiRecovery(directory, id => orchestrator.getRunStatus(id));
    const cleanup = new SqliteTurnCleanupStore();
    const cleaned = orchestrator.cleanupStaleRunningTurns(cleanup, { forceAll: true, preserveRunIds: new Set(pending.map(owner => owner.runId)) });
    cleanup.close();
    if (pending.length !== 1 || cleaned !== 0) throw new Error(`Lost original owner: ${pending.length}, cleaned ${cleaned}`);
    let notify: ((text: string) => Promise<void>) | undefined;
    if (transport) {
      if (pending[0].channel !== 'web' || JSON.stringify(pending[0].transport) !== JSON.stringify(transport)) throw new Error('Lost transport/native ownership separation');
      const manager = { apply: () => {}, stop: () => {}, getWorkspaceDir: () => transport.workspaceDir,
        sendInternalNotice: async (chatId: string, text: string) => { appendFileSync(join(directory, 'ledger'), `notify:${chatId}:${text}\n`); } };
      const selected = piRecoveryChannelManager(pending[0], new Map([[transport.channel, new Map([[transport.instanceId, manager]])]]));
      if (selected !== manager) throw new Error('Lost original transport manager');
      notify = text => selected.sendInternalNotice!(transport.chatId, text, { kind: 'pi_deferred_completion', filename: pending[0].runId });
    }
    result = await resumePiOwner(pending[0], runner, new SessionStore(), notify);
  }
  clearInterval(keepAlive); process.send?.({ type: 'result', result, events }); process.disconnect?.();
} catch (error) { clearInterval(keepAlive); process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; process.disconnect?.(); }

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PiRecoveryStore } from '$lib/server/agent/core/piRecoveryStore.js';
import { pendingPiRecovery, resumePiOwner, piRecoveryChannelManager } from './piRecovery.js';

for (const scenario of [{ mode: 'interrupt' }, { mode: 'interrupt-gap' }, { mode: 'interrupt', project: 'telegram' }, { mode: 'interrupt', project: 'feishu' }]) test(`production Runner Deferred ${scenario.mode} ${scenario.project ?? ''} survives SIGKILL and startup cleanup without resubmission`, { timeout: 25000 }, async () => {
  const { mode } = scenario;
  const directory = mkdtempSync(join(tmpdir(), 'molibot-pi-runner-recovery-'));
  const children: ReturnType<typeof fork>[] = [];
  const worker = (mode: string) => {
    const child = fork('evals/fixtures/pi-runner-deferred-worker.ts', [], {
      execArgv: ['--import', './scripts/register-loader.js', '--import', 'tsx'],
      env: { ...process.env, DB_DIR: join(directory, 'db'), SETTINGS_DB_FILE: join(directory, 'db', 'settings.sqlite'), SETTINGS_FILE: join(directory, 'settings.json'), WEB_WORKSPACE_DIR: join(directory, 'moli-w'), SESSIONS_DIR: join(directory, 'sessions'), SESSIONS_INDEX_FILE: join(directory, 'sessions', 'index.json'), DATA_DIR: directory, PI_CODING_AGENT_DIR: join(directory, 'pi'), PI_DEFERRED_FIXTURE_MODE: mode, PI_DEFERRED_FIXTURE_PROJECT: scenario.project ?? "" }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr?.on('data', data => { if (String(data).includes('Error:')) process.stderr.write(data); });
    children.push(child); return child;
  };
  try {
    const first = worker(mode);
    const [barrier] = await once(first, 'message');
    assert.equal(barrier.type, 'barrier', barrier.error);
    const exit = once(first, 'exit'); first.kill('SIGKILL'); await exit;
    const owners = new PiRecoveryStore(directory);
    try { assert.equal(owners.waiting().length, mode === 'interrupt-gap' ? 0 : 1); assert.equal(owners.all()[0].actor, 'actor'); }
    finally { owners.close(); }
    const resumed = worker('resume'); const finished = once(resumed, 'exit');
    const [completion] = await once(resumed, 'message');
    assert.equal(completion.type, 'result', completion.error);
    assert.equal(completion.result.stopReason, 'stop', completion.result.errorMessage);
    assert.equal(completion.result.usage.totalTokens, 2);
    assert.ok(completion.events.some((event: any) => event.stage === 'runtime.notice' && event.payload.code === 'PI_DEFERRED_WAITING'));
    await finished;
    const ledger = readFileSync(join(directory, 'ledger'), 'utf8').trim().split('\n');
    assert.equal(ledger.filter(line => line === 'submit').length, 1);
    assert.deepEqual(ledger.filter(line => line.startsWith('poll:')), ['poll:original-job', 'poll:original-job']);
    if (scenario.project) assert.deepEqual(ledger.filter(line => line.startsWith('notify:')), [`notify:${scenario.project === 'telegram' ? '-100__topic_7' : 'original-chat:topic'}:Original async answer`]);
    const final = new PiRecoveryStore(directory); try { assert.deepEqual(final.waiting(), []); } finally { final.close(); }
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a terminal Stop decision prevents a late Deferred restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'molibot-pi-terminal-'));
  const store = new PiRecoveryStore(directory);
  try {
    store.save({ runId: 'stopped', workspaceDir: directory, chatId: 'chat', sessionId: 'session', channel: 'web',
      context: {}, actor: 'actor', workspaceId: 'personal', models: [], deferred: true });
    assert.deepEqual(await pendingPiRecovery(directory, () => 'aborted'), []);
    assert.equal(store.read('stopped'), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});


for (const channel of ["telegram", "feishu"]) test(`${channel} restart retains the actor and routes completion only to the original workspace`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-channel-recovery-"));
  try {
    const owner = { runId: "original", budgetId: "original-budget", workspaceDir: join(directory, "project-runtime"), chatId: "project-chat", sessionId: "session",
      channel: "web", transport: { channel, instanceId: "original", workspaceDir: directory, chatId: "original-topic" }, context: {}, actor: "original-actor", workspaceId: "personal", models: [], deferred: true };
    const sent: string[] = [];
    const manager = { apply: () => {}, stop: () => {}, getWorkspaceDir: () => directory,
      sendInternalNotice: async (_chat: string, text: string) => { sent.push(text); } };
    const wrong = { ...manager, getWorkspaceDir: () => join(directory, "other") };
    const managers = new Map([[channel, new Map([["wrong", wrong], ["original", manager]])]]);
    assert.equal(piRecoveryChannelManager(owner, managers), manager);
    assert.equal(piRecoveryChannelManager(owner, new Map([[channel, new Map([["wrong", wrong]])]])), undefined);
    const messages: string[] = [];
    const result = await resumePiOwner(owner, { run: async context => {
      assert.equal(context.message.runId, "original"); assert.equal(context.message.budgetId, "original-budget");
      assert.equal(context.channel, channel); assert.equal(context.workspaceDir, owner.workspaceDir); assert.equal(context.message.chatId, "project-chat");
      assert.deepEqual(context.deliveryTarget, owner.transport);
      assert.equal(context.message.userId, "original-actor"); assert.equal(context.message.isEvent, true); assert.equal(context.message.text, "");
      await context.respond("Original answer"); return { stopReason: "stop", assistantSourceEntryId: "native-answer" };
    } }, { appendMessage: (_id, _role, content) => { messages.push(content); return {} as never; } },
    text => manager.sendInternalNotice(owner.transport.chatId, text));
    assert.equal(result.stopReason, "stop"); assert.deepEqual(sent, ["Original answer"]); assert.deepEqual(messages, sent);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

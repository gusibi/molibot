import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storagePaths } from '../../../src/lib/server/infra/db/storage.js';
import { SettingsStore } from '../../../src/lib/server/settings/store.js';
import { SqliteTraceStore } from '../../../src/lib/server/agent/hooks/traceStore.js';
import { getEventExecutionLeaseStore } from '../../../src/lib/server/agent/eventsLeaseStore.js';
import { HostBashStore } from '../../../src/lib/server/hostBash/store.js';
import { SessionStore } from '../../../src/lib/server/sessions/store.js';
import { assertIsolatedDataDir, isInsideDir } from './guard.js';

/**
 * Seeds one Handover scenario into an already-stopped isolated instance, then
 * exits. The test stops the service, runs this, and starts it again, so the
 * service's own SQLite handles never race this writer.
 *
 * UI_HANDOVER_SCENARIO:
 *   active    — one completed Default-Agent run and one pending approval
 *   busy      — six completed runs, one clipped provider failure, six pending approvals
 *   history   — yesterday + today finished rows
 *   quiet     — nothing happened since the last acknowledged view
 *   first-run — no history and no acknowledged view
 *   cross-channel — three ad-hoc replies on Feishu/WeChat that the owner already read there
 *   external-source — one task delivery whose Session only exists in the external contexts
 */
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Handover seed requires DATA_DIR');
assertIsolatedDataDir(dataDir, 'Handover seed');
if (storagePaths.dataDir !== resolve(dataDir) || !isInsideDir(dataDir, storagePaths.settingsDbFile)) {
  throw new Error('Handover seed storage escapes the isolated instance');
}

const scenario = String(process.env.UI_HANDOVER_SCENARIO ?? 'active');
const now = new Date();

const SEED_TITLE = 'Handover seed';
const sessions = new SessionStore();

/** Every seeded record points at a real Session, so "open the source" is testable. */
function seedSession(): string {
  const conversation = sessions.createWebConversation('web:personal:web-anonymous', undefined, 'default');
  sessions.renameConversation(conversation.id, 'web', 'web:personal:web-anonymous', SEED_TITLE);
  return conversation.id;
}


const leases = getEventExecutionLeaseStore();

/** A completed scheduled task: the only kind of item the home counts as a result. */
function seedCompletedTask(input: { sessionId: string; text: string; finishedAt: Date; runId: string; taskId: string; preview?: string }): void {
  const startedAt = new Date(input.finishedAt.getTime() - 45_000);
  const acquired = leases.acquire({
    now: startedAt,
    leaseScope: "agent:default",
    eventFile: `${input.taskId}.json`,
    eventType: "periodic",
    triggerSlot: `seed:${input.taskId}`,
    chatId: "web:personal:web-anonymous",
    sessionId: input.sessionId,
    channel: "web",
    taskId: input.taskId,
    runId: input.runId,
    maxAttempts: 1,
    timeoutMs: 60_000,
    eventPayloadJson: JSON.stringify({ text: input.text })
  });
  if (!acquired) throw new Error(`Could not seed ${input.taskId}`);
  leases.markCompleted(acquired.id, input.runId, { text: input.preview ?? `${input.text} delivered` }, input.finishedAt);
}

function resetHandoverState(): void {
  for (const meta of sessions.listAllWebConversationMeta()) {
    if (meta.conversation.title === SEED_TITLE) {
      sessions.deleteConversation(meta.conversation.id, 'web', meta.externalUserId);
    }
  }
  const db = new DatabaseSync(storagePaths.settingsDbFile);
  try {
    db.exec(`
      DELETE FROM agent_trace_facts;
      DELETE FROM event_execution_leases;
      DELETE FROM approvals WHERE status = 'pending';
    `);
  } finally {
    db.close();
  }
  // The quiet scenario writes a task file; other scenarios must not inherit it.
  rmSync(join(String(dataDir), 'sessions', 'default', 'events', 'task-handover-quiet.json'), { force: true });
  const store = new SettingsStore();
  const settings = store.load();
  delete settings.desktopNavigation.lastAcknowledgedAt;
  delete settings.desktopNavigation.previousHandover;
  store.saveDesktopNavigation(settings);
}

resetHandoverState();

if (scenario === 'active') {
  const sessionId = seedSession();
  seedCompletedTask({
    sessionId,
    text: 'Handover UI task',
    finishedAt: now,
    runId: 'handover-ui-run',
    taskId: 'handover-ui-task'
  });

  const hostBash = new HostBashStore();
  hostBash.requestApproval({
    toolId: 'agent-browser',
    displayName: 'Handover approval',
    command: 'agent-browser --open',
    reason: 'Needs browser IPC outside the sandbox.',
    approvalMode: 'ephemeral',
    channel: 'web',
    chatId: 'web:personal:web-anonymous',
    scopeId: 'web:personal:web-anonymous',
    sessionId,
    owner: { kind: 'agent', id: 'default' }
  });
}

if (scenario === 'cross-channel') {
  const trace = new SqliteTraceStore();
  try {
    (['feishu', 'feishu', 'weixin'] as const).forEach((channel, index) => {
      const sessionId = seedSession();
      trace.upsertFact({
        id: `handover-cross-${index}`,
        factType: 'run',
        runId: `handover-cross-${index}`,
        factId: `handover-cross-${index}`,
        channel,
        botId: 'default',
        chatId: `${channel}:personal`,
        sessionId,
        name: sessionId,
        status: 'success',
        startedAt: new Date(now.getTime() - (index + 1) * 5 * 60_000 - 30_000).toISOString(),
        finishedAt: new Date(now.getTime() - (index + 1) * 5 * 60_000).toISOString(),
        durationMs: 30_000,
        payload: { agentId: 'default', taskPreview: 'Answered on another channel' },
        createdAt: new Date(now.getTime() - (index + 1) * 5 * 60_000 - 30_000).toISOString(),
        updatedAt: new Date(now.getTime() - (index + 1) * 5 * 60_000).toISOString()
      });
    });
  } finally {
    trace.close();
  }

  const store = new SettingsStore();
  const settings = store.load();
  settings.desktopNavigation.lastAcknowledgedAt = new Date(now.getTime() - 60 * 60_000).toISOString();
  store.saveDesktopNavigation(settings);
}

if (scenario === 'external-source') {
  seedCompletedTask({
    sessionId: 'external-source-1',
    text: 'External source task',
    finishedAt: now,
    runId: 'handover-external-source',
    taskId: 'handover-external-source'
  });
}

if (scenario === 'quiet') {
  const store = new SettingsStore();
  const settings = store.load();
  settings.desktopNavigation.lastAcknowledgedAt = now.toISOString();
  store.saveDesktopNavigation(settings);

  // One future periodic task gives the quiet page its "next scheduled" line.
  const eventsDir = join(dataDir, 'sessions', 'default', 'events');
  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(join(eventsDir, 'task-handover-quiet.json'), JSON.stringify({
    type: 'periodic',
    taskId: 'handover-quiet',
    agentId: 'default',
    enabled: true,
    delivery: 'text',
    chatId: 'web:personal:web-anonymous',
    text: 'Quiet briefing',
    schedule: '0 8 * * *',
    timezone: 'UTC',
    status: { state: 'pending', runCount: 0 }
  }, null, 2));
}

if (scenario === 'busy') {
  const sessionIds = Array.from({ length: 6 }, () => seedSession());
  const failureSessionId = seedSession();
  for (let index = 1; index <= 6; index += 1) {
    seedCompletedTask({
      sessionId: sessionIds[index - 1],
      text: `Busy task ${index}`,
      finishedAt: new Date(now.getTime() - index * 60_000),
      runId: `handover-busy-run-${index}`,
      taskId: `handover-busy-task-${index}`
    });
  }

  const failedStartedAt = new Date(now.getTime() - 30_000);
  const failed = leases.acquire({
    now: failedStartedAt,
    leaseScope: "agent:default",
    eventFile: "handover-busy-failure.json",
    eventType: "periodic",
    triggerSlot: "seed:handover-busy-failure",
    chatId: "web:personal:web-anonymous",
    sessionId: failureSessionId,
    channel: "web",
    taskId: "handover-busy-failure",
    runId: "handover-busy-failure",
    maxAttempts: 1,
    timeoutMs: 60_000,
    eventPayloadJson: JSON.stringify({ text: "Check the invoices" })
  });
  if (!failed) throw new Error("Could not seed the failed task");
  leases.markFailed(
    failed.id,
    "handover-busy-failure",
    [
      "Run failed after model attempts:",
      'provider=cli-proxy-api, model=deepseek-v4.1-flash, baseUrl=https://proxy.example.invalid/v1, endpoint=https://proxy.example.invalid/v1/chat/completions, type=request_error, error=503: '
        + '{"message":"auth_unavailable: no auth available","type":"server_error","code":"internal_server_error"}',
      "Run budget exceeded: too many model failures (6/6)."
    ].join(" | "),
    now
  );

  const hostBash = new HostBashStore();
  for (let index = 1; index <= 6; index += 1) {
    hostBash.requestApproval({
      toolId: `agent-browser-${index}`,
      displayName: `Busy approval ${index}`,
      command: `agent-browser --open ${index}`,
      reason: 'Needs browser IPC outside the sandbox.',
      approvalMode: 'ephemeral',
      pendingAction: { kind: 'run_approved_host_bash', originalCommand: `agent-browser --open ${index}`, args: ['--open', String(index)] },
      channel: 'web',
      chatId: 'web:personal:web-anonymous',
      scopeId: 'web:personal:web-anonymous',
      sessionId: sessionIds[index - 1],
      owner: { kind: 'agent', id: 'default' }
    });
  }
}

if (scenario === 'history') {
  const sessionIds = { today: seedSession(), yesterday: seedSession() };
  seedCompletedTask({
    sessionId: sessionIds.today,
    text: 'Grouped task today',
    finishedAt: now,
    runId: 'handover-grouped-today',
    taskId: 'handover-grouped-today'
  });
  seedCompletedTask({
    sessionId: sessionIds.yesterday,
    text: 'Grouped task yesterday',
    finishedAt: new Date(now.getTime() - 26 * 60 * 60_000),
    runId: 'handover-grouped-yesterday',
    taskId: 'handover-grouped-yesterday'
  });
}


if (scenario === 'editorial') {
  const deliveries = [
    ['Weekly research brief', 'Agent reliability: three things worth your attention.\nClear completion criteria, recoverable failures and decisions with enough context to act.'],
    ['A draft for your next article', 'A practical angle on agent reliability, with an opening argument and a three-part structure ready to review.'],
    ['Reading notes, brought together', 'Source notes grouped by question, with the unresolved points kept visible for your next reading session.']
  ];
  for (const [index, [text, preview]] of deliveries.entries()) {
    seedCompletedTask({ sessionId: seedSession(), text, preview, finishedAt: new Date(now.getTime() - index * 60_000), runId: `editorial-run-${index}`, taskId: `editorial-task-${index}` });
  }
  const hostBash = new HostBashStore();
  const requests = [
    { toolId: 'pdftotext', displayName: 'Read the source documents', command: 'pdftotext ./reports/research.pdf -', args: ['./reports/research.pdf', '-'] },
    { toolId: 'agent-browser', displayName: 'Check the draft references', command: 'agent-browser --open https://example.org/research', args: ['--open', 'https://example.org/research'] }
  ];
  for (const request of requests) {
    hostBash.requestApproval({
      ...request,
      reason: 'Read the source before continuing the research.',
      approvalMode: 'ephemeral',
      pendingAction: { kind: 'run_approved_host_bash', originalCommand: request.command, args: request.args },
      channel: 'web',
      chatId: 'web:personal:web-anonymous',
      scopeId: 'web:personal:web-anonymous',
      sessionId: seedSession(),
      owner: { kind: 'agent', id: 'default' }
    });
  }
}

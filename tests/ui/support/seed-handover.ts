import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storagePaths } from '../../../src/lib/server/infra/db/storage.js';
import { SettingsStore } from '../../../src/lib/server/settings/store.js';
import { SqliteTraceStore } from '../../../src/lib/server/agent/hooks/traceStore.js';
import { HostBashStore } from '../../../src/lib/server/hostBash/store.js';
import { assertIsolatedDataDir, isInsideDir } from './guard.js';

/**
 * Seeds one Handover scenario into an already-stopped isolated instance, then
 * exits. The test stops the service, runs this, and starts it again, so the
 * service's own SQLite handles never race this writer.
 *
 * UI_HANDOVER_SCENARIO:
 *   active    — one completed Default-Agent run and one pending approval
 *   busy      — six completed runs, one clipped provider failure, six pending approvals
 *   quiet     — nothing happened since the last acknowledged view
 *   first-run — no history and no acknowledged view
 */
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Handover seed requires DATA_DIR');
assertIsolatedDataDir(dataDir, 'Handover seed');
if (storagePaths.dataDir !== resolve(dataDir) || !isInsideDir(dataDir, storagePaths.settingsDbFile)) {
  throw new Error('Handover seed storage escapes the isolated instance');
}

const scenario = String(process.env.UI_HANDOVER_SCENARIO ?? 'active');
const now = new Date();

function resetHandoverState(): void {
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
  const store = new SettingsStore();
  const settings = store.load();
  delete settings.desktopNavigation.lastAcknowledgedAt;
  delete settings.desktopNavigation.previousHandover;
  store.saveDesktopNavigation(settings);
}

resetHandoverState();

if (scenario === 'active') {
  const trace = new SqliteTraceStore();
  try {
    trace.upsertFact({
      id: 'handover-ui-run',
      factType: 'run',
      runId: 'handover-ui-run',
      factId: 'handover-ui-run',
      channel: 'web',
      botId: 'default',
      chatId: 'web:personal:web-anonymous',
      sessionId: 'handover-ui-session',
      name: 'handover-ui-session',
      status: 'success',
      startedAt: new Date(now.getTime() - 45_000).toISOString(),
      finishedAt: now.toISOString(),
      durationMs: 45_000,
      payload: { agentId: 'default', taskPreview: 'Handover UI task' },
      createdAt: new Date(now.getTime() - 45_000).toISOString(),
      updatedAt: now.toISOString()
    });
  } finally {
    trace.close();
  }

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
    sessionId: 'handover-ui-session',
    owner: { kind: 'agent', id: 'default' }
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
  const trace = new SqliteTraceStore();
  try {
    for (let index = 1; index <= 6; index += 1) {
      trace.upsertFact({
        id: `handover-busy-run-${index}`,
        factType: 'run',
        runId: `handover-busy-run-${index}`,
        factId: `handover-busy-run-${index}`,
        channel: 'web',
        botId: 'default',
        chatId: 'web:personal:web-anonymous',
        sessionId: `handover-busy-session-${index}`,
        name: `handover-busy-session-${index}`,
        status: 'success',
        startedAt: new Date(now.getTime() - index * 60_000).toISOString(),
        finishedAt: new Date(now.getTime() - index * 60_000).toISOString(),
        durationMs: 45_000,
        payload: { agentId: 'default', taskPreview: `Busy task ${index}` },
        createdAt: new Date(now.getTime() - index * 60_000).toISOString(),
        updatedAt: new Date(now.getTime() - index * 60_000).toISOString()
      });
    }
    trace.upsertFact({
      id: 'handover-busy-failure',
      factType: 'run',
      runId: 'handover-busy-failure',
      factId: 'handover-busy-failure',
      channel: 'web',
      botId: 'default',
      chatId: 'web:personal:web-anonymous',
      sessionId: 'handover-busy-failure-session',
      name: 'handover-busy-failure-session',
      status: 'error',
      startedAt: new Date(now.getTime() - 30_000).toISOString(),
      finishedAt: now.toISOString(),
      payload: { agentId: 'default', taskPreview: 'Check the invoices' },
      errorPreview: [
        'Run failed after model attempts:',
        'provider=cli-proxy-api, model=deepseek-v4.1-flash, baseUrl=https://proxy.example.invalid/v1, endpoint=https://proxy.example.invalid/v1/chat/completions, type=request_error, error=503: '
          + '{"message":"auth_unavailable: no auth available","type":"server_error","code":"internal_server_error"}',
        'provider=cli-proxy-api, model=deepseek-v4.1-flash, type=request_error, error=503: '
          + '{"message":"auth_unavailable: no auth available","type":"server_error","code":"internal_server_error"}',
        'Run budget exceeded: too many model failures (6/6).'
      ].join(' | '),
      createdAt: new Date(now.getTime() - 30_000).toISOString(),
      updatedAt: now.toISOString()
    });
  } finally {
    trace.close();
  }

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
      sessionId: `handover-busy-session-${index}`,
      owner: { kind: 'agent', id: 'default' }
    });
  }
}

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('production Runner killed during a model request is not resent on restart', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'molibot-pi-ordinary-'));
  const children: ReturnType<typeof fork>[] = [];
  const worker = (mode: string) => {
    const child = fork('evals/fixtures/pi-runner-ordinary-worker.ts', [], {
      execArgv: ['--import', './scripts/register-loader.js', '--import', 'tsx'],
      env: { ...process.env, DB_DIR: join(directory, 'db'), SETTINGS_DB_FILE: join(directory, 'db', 'settings.sqlite'),
        SETTINGS_FILE: join(directory, 'settings.json'), WEB_WORKSPACE_DIR: join(directory, 'moli-w'),
        SESSIONS_DIR: join(directory, 'sessions'), SESSIONS_INDEX_FILE: join(directory, 'sessions', 'index.json'),
        DATA_DIR: directory, PI_CODING_AGENT_DIR: join(directory, 'pi'), PI_ORDINARY_FIXTURE_MODE: mode },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr?.on('data', data => { if (String(data).includes('Error:')) process.stderr.write(data); });
    children.push(child); return child;
  };
  try {
    const first = worker('interrupt');
    const [barrier] = await once(first, 'message') as [Record<string, unknown>];
    assert.equal(barrier.type, 'barrier', barrier.error as string | undefined);
    const exit = once(first, 'exit'); first.kill('SIGKILL'); await exit;

    const inspector = worker('inspect');
    const [completion] = await once(inspector, 'message') as [Record<string, unknown>];
    assert.equal(completion.type, 'result', completion.error as string | undefined);
    assert.equal(completion.disposition, 'review');
    assert.equal(completion.pending, 0);
    await once(inspector, 'exit');

    const ledger = readFileSync(join(directory, 'ledger'), 'utf8').trim().split('\n').filter(line => line === 'submit');
    assert.equal(ledger.length, 1, 'the interrupted model request must not be resent');
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

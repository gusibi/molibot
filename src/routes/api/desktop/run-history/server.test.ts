import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('desktop history endpoint awaits the async reader and returns bounded safe records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'molibot-history-api-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const workspace = join(root, 'sessions', 'assistant');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'run-summaries.jsonl'), Array.from({ length: 1000 }, (_, i) => JSON.stringify({ runId: `run-${i}`, createdAt: new Date(i * 1000).toISOString(), finalText: 'private output', reflection: { outcome: 'success', summary: 'Completed' } })).join('\n'));
    const { config } = await import('$lib/server/app/env');
    assert.equal(config.dataDir, root);
    const { GET } = await import('./+server');
    const start = performance.now();
    const response = await GET({ url: new URL('http://localhost/api/desktop/run-history?limit=20') } as Parameters<typeof GET>[0]);
    const payload = await response.json();
    console.log(`history HTTP handler: ${Math.round(performance.now() - start)}ms for 1,000 source rows`);
    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 20);
    assert.equal(payload.items[0].runId, 'run-999');
    assert.equal(payload.counts.total, 20);
    assert.equal(JSON.stringify(payload).includes('private output'), false);
    assert.equal(JSON.stringify(payload).includes(root), false);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(root, { recursive: true, force: true });
  }
});

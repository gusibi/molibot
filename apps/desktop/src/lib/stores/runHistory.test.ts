import assert from 'node:assert/strict';
import test from 'node:test';

(globalThis as any).$state = <T>(value: T): T => value;
(globalThis as any).$derived = <T>(value: T): T => value;

test('history coalesces overlapping loads, exposes failures locally, and reloads empty results', async () => {
  const { runHistoryStore, loadRunHistory } = await import('./runHistory.svelte');
  const originalFetch = globalThis.fetch;
  let resolve!: (response: Response) => void;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Promise<Response>(done => { resolve = done; });
  }) as typeof fetch;
  try {
    const first = loadRunHistory('http://history.test');
    const second = loadRunHistory('http://history.test');
    assert.equal(requests, 1, 'remounting during an initial request must not restart the same scan');
    resolve(new Response(JSON.stringify({ ok: true, items: [] })));
    await Promise.all([first, second]);
    assert.equal(runHistoryStore.loaded, true);
    assert.equal(runHistoryStore.loading, false);
    const failed = loadRunHistory('http://history.test');
    resolve(new Response(JSON.stringify({ ok: false, error: 'History unavailable' }), { status: 503 }));
    await failed;
    assert.match(runHistoryStore.error, /History unavailable/);
    assert.equal(runHistoryStore.refreshing, false);
    const retry = loadRunHistory('http://history.test');
    resolve(new Response(JSON.stringify({ ok: true, items: [] })));
    await retry;
    assert.equal(runHistoryStore.error, '');
    assert.equal(requests, 3);
  } finally { globalThis.fetch = originalFetch; }
});


test('a late response from an old endpoint cannot replace the selected service history', async () => {
  const { runHistoryStore, loadRunHistory } = await import('./runHistory.svelte');
  const originalFetch = globalThis.fetch;
  const pending = new Map<string, (response: Response) => void>();
  globalThis.fetch = (async input => new Promise<Response>(resolve => pending.set(String(input), resolve))) as typeof fetch;
  try {
    const old = loadRunHistory('http://old-history.test');
    const current = loadRunHistory('http://new-history.test');
    pending.get('http://new-history.test/api/desktop/run-history?limit=200')!(new Response(JSON.stringify({ ok: true, items: [{ runId: 'new' }] })));
    await current;
    pending.get('http://old-history.test/api/desktop/run-history?limit=200')!(new Response(JSON.stringify({ ok: true, items: [{ runId: 'old' }] })));
    await old;
    assert.equal(runHistoryStore.endpoint, 'http://new-history.test');
    assert.equal(runHistoryStore.runHistory[0]?.runId, 'new');
    assert.equal(runHistoryStore.loading, false);
  } finally { globalThis.fetch = originalFetch; }
});

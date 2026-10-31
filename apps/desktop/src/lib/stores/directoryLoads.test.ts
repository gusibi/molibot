import assert from 'node:assert/strict';
import test from 'node:test';

(globalThis as any).$state = <T>(value: T): T => value;
(globalThis as any).$derived = <T>(value: T): T => value;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('directory load failures expose a retryable state and a retry clears the error', async () => {
  const { agentsStore, loadAgents } = await import('./agents.svelte');
  const { channelsStore, loadChannels } = await import('./channels.svelte');
  const original = globalThis.fetch;
  let fail = true;
  globalThis.fetch = (async input => {
    if (fail) return response({ ok: false, error: 'Fixture unavailable' }, 503);
    return String(input).endsWith('agent-templates') ? response({ ok: true, templates: [] }) : response({ ok: true, summary: { items: [], groups: [], counts: { total: 0, enabled: 0, totalInstances: 0, enabledInstances: 0 } } });
  }) as typeof fetch;
  try {
    await Promise.all([loadAgents('http://directory.test'), loadChannels('http://directory.test')]);
    assert.match(agentsStore.error, /Fixture unavailable/);
    assert.match(channelsStore.error, /Fixture unavailable/);
    assert.equal(agentsStore.loading, false);
    assert.equal(channelsStore.loading, false);
    fail = false;
    await Promise.all([loadAgents('http://directory.test'), loadChannels('http://directory.test')]);
    assert.equal(agentsStore.error, '');
    assert.equal(channelsStore.error, '');
  } finally { globalThis.fetch = original; }
});

test('a late response cannot overwrite either directory after changing services', async () => {
  const { agentsStore, loadAgents } = await import('./agents.svelte');
  const { channelsStore, loadChannels } = await import('./channels.svelte');
  const original = globalThis.fetch;
  const pending = new Map<string, (response: Response) => void>();
  globalThis.fetch = (async input => new Promise<Response>(resolve => pending.set(String(input), resolve))) as typeof fetch;
  try {
    const older = Promise.all([loadAgents('http://old.test'), loadChannels('http://old.test')]);
    const newer = Promise.all([loadAgents('http://new.test'), loadChannels('http://new.test')]);
    function finish(endpoint: string) {
      pending.get(`${endpoint}/api/desktop/agents`)!(response({ ok: true, summary: { items: [{ id: endpoint }], counts: { total: 1, enabled: 1 } } }));
      pending.get(`${endpoint}/api/desktop/agent-templates`)!(response({ ok: true, templates: [] }));
      pending.get(`${endpoint}/api/desktop/channels`)!(response({ ok: true, summary: { groups: [{ channel: endpoint }], counts: { totalInstances: 1, enabledInstances: 1 } } }));
    }
    finish('http://new.test'); await newer;
    finish('http://old.test'); await older;
    assert.equal(agentsStore.agents?.items[0]?.id, 'http://new.test');
    assert.equal(channelsStore.channels?.groups[0]?.channel, 'http://new.test');
  } finally { globalThis.fetch = original; }
});

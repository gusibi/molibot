import test from 'node:test';
import assert from 'node:assert/strict';
import { stream as streamOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { startModelService, modelRequestMatchers, type ModelService } from './model-service.js';

function modelFor(service: ModelService) {
  return {
    api: 'openai-completions' as const,
    id: 'fixture',
    provider: 'fixture',
    name: 'Fixture',
    baseUrl: `${service.url.replace(/\/v1$/, '')}/v1`,
    reasoning: false,
    input: ['text'] as const,
    contextWindow: 8192,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

function context(userText = 'hi') {
  return { systemPrompt: 'test system', messages: [{ role: 'user', content: userText, timestamp: Date.now() }], tools: [] };
}

function call(service: ModelService, userText = 'hi') {
  return streamOpenAICompletions(modelFor(service) as never, context(userText) as never, { apiKey: 'x' } as never);
}

function textOf(message: { content?: Array<{ type: string; text?: string }> }): string {
  return (message.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
}

test('chunked tool-call arguments are reassembled by the real adapter', async () => {
  const service = await startModelService();
  try {
    service.script({
      name: 'tool',
      reply: { type: 'toolCalls', calls: [{ name: 'write', args: { path: 'a.txt', content: 'hello', label: 'L' }, argChunks: 6 }] }
    });
    const message = await call(service).result();
    const toolCall = (message.content ?? []).find(part => part.type === 'toolCall') as { name: string; arguments: unknown };
    assert.equal(toolCall.name, 'write');
    assert.deepEqual(toolCall.arguments, { path: 'a.txt', content: 'hello', label: 'L' });
    assert.equal(message.stopReason, 'toolUse');
  } finally {
    await service.close();
  }
});

test('multiple tool calls in one turn are parsed independently', async () => {
  const service = await startModelService();
  try {
    service.script({
      name: 'multi',
      reply: { type: 'toolCalls', calls: [{ name: 'read', args: { path: 'a.txt' } }, { name: 'read', args: { path: 'b.txt' } }] }
    });
    const message = await call(service).result();
    const calls = (message.content ?? []).filter(part => part.type === 'toolCall') as Array<{ name: string; arguments: unknown }>;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.arguments), [{ path: 'a.txt' }, { path: 'b.txt' }]);
  } finally {
    await service.close();
  }
});

test('an unmatched request is recorded and fails the call', async () => {
  const service = await startModelService();
  try {
    const message = await call(service, 'no script for this').result();
    assert.equal(message.stopReason, 'error');
    assert.equal(service.unmatched.length, 1);
    assert.equal(service.unmatched[0].matched, null);
  } finally {
    await service.close();
  }
});

test('a hold pauses until released and then completes', async () => {
  const service = await startModelService();
  const deltas: string[] = [];
  try {
    service.script({ name: 'hold', reply: { type: 'hold', text: 'WAIT:', key: 'k', tail: 'DONE', delayMs: 10 } });
    const stream = call(service);
    const consumer = (async () => {
      for await (const event of stream as unknown as AsyncIterable<{ type: string; delta?: string }>) {
        if (event.type === 'text_delta' && event.delta) deltas.push(event.delta);
      }
    })();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(deltas.join('').includes('WAIT'), `expected partial text, got ${JSON.stringify(deltas)}`);
    service.release('k');
    const message = await stream.result();
    await consumer;
    assert.equal(textOf(message as never), 'WAIT:DONE');
  } finally {
    await service.close();
  }
});

test('matchers read the last user text and tool results', async () => {
  const service = await startModelService();
  try {
    service.script({
      name: 'after-tool',
      when: request => modelRequestMatchers(request).afterToolResults,
      reply: { type: 'text', text: 'second round' }
    });
    service.script({ name: 'first', reply: { type: 'text', text: 'first round' } });
    const first = await call(service, 'hello').result();
    assert.equal(textOf(first as never), 'first round');
    assert.equal(service.requests[0].matched, 'first');
  } finally {
    await service.close();
  }
});

test('a non-streaming client receives a single JSON body', async () => {
  const service = await startModelService();
  try {
    service.script({ name: 'json', reply: { type: 'text', text: 'HELLO' } });
    const response = await fetch(`${service.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'hi' }] })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { choices: Array<{ message: { content: string } }> };
    assert.equal(body.choices[0].message.content, 'HELLO');
    assert.equal(service.requests[0].stream, false);
  } finally {
    await service.close();
  }
});

for (const kind of ['mid-stream-error', 'disconnect'] as const) {
  test(`a ${kind} ends the stream as an error`, async () => {
    const service = await startModelService();
    try {
      service.script({ name: kind, reply: { type: 'markerThenDrop', kind, text: 'PARTIAL' } });
      const message = await call(service).result();
      assert.equal(message.stopReason, 'error');
    } finally {
      await service.close();
    }
  });
}

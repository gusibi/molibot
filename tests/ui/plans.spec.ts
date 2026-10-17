import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { modelRequestMatchers } from './support/model-service';

test('generated 31-step plan executes independently, hands off to a busy Session and requires owner acceptance @plans @chat @approval', async ({ request, instance }) => {
  test.setTimeout(180000);
  instance.model.resetScripts();
  const requestBaseline = instance.model.requests.length;
  const token = randomUUID().slice(0, 8);
  const headers = { origin: instance.endpoint };
  const post = async (path: string, data: unknown) => {
    const response = await request.post(instance.endpoint + path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const source = (await post("/api/sessions", { profileId: "default", userId: `source-${token}`, agentId: "default" })).session;
  const receiver = (await post("/api/sessions", { profileId: "default", userId: `receiver-${token}`, agentId: "default" })).session;
  await post('/api/desktop/session-permission', { profileId: 'default', conversationId: source.id, mode: 'plan' });
  instance.model.script({ name: 'plan-proposal', when: value => value.tools.includes('exitPlan') && modelRequestMatchers(value).lastUserText.includes(token), reply: { type: 'toolCalls', calls: [{ name: 'exitPlan', args: { title: `Plan ${token}`, summary: 'Read and verify every local fixture item.', steps: Array.from({ length: 31 }, (_, at) => `fixture-step ${at + 1}`) } }] } });
  instance.model.script({ name: 'busy-ordinary', when: value => modelRequestMatchers(value).lastUserText.includes(`ordinary-${token}`), reply: { type: 'hold', key: token, text: 'Ordinary work is still running.', tail: 'Ordinary work finished.' } });
  instance.model.script({ name: 'plan-step', when: value => modelRequestMatchers(value).lastUserText.includes('Current step: fixture-step'), reply: { type: 'text', text: 'Verified the local fixture item.' } });
  const proposed = await request.post(instance.endpoint + '/api/stream', { headers, data: { profileId: 'default', conversationId: source.id, userId: `source-${token}`, message: `Generate all 31 steps for ${token}` } });
  expect(proposed.ok(), await proposed.text()).toBe(true);
  const list = await (await request.get(instance.endpoint + `/api/desktop/plans?search=${token}`)).json();
  expect(list.items).toHaveLength(1);
  const planId = list.items[0].planId;
  const read = async () => (await (await request.get(instance.endpoint + `/api/desktop/plans?id=${planId}`)).json()).item;
  expect((await read()).tasks.flatMap((task: any) => task.steps)).toHaveLength(31);
  const busyResponse = await fetch(instance.endpoint + '/api/stream', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'default', conversationId: receiver.id, userId: `receiver-${token}`, message: `ordinary-${token}`, durableMode: 'suppress' }) });
  const busyBody = busyResponse.text();
  try {
    await expect.poll(() => instance.model.requests.some(value => value.matched === 'busy-ordinary')).toBe(true);
    const before = await read();
    const approved = await post('/api/desktop/plans', { action: 'approve', planId, expectedVersion: before.execution.version, sessionId: receiver.id, mode: 'manual' });
    expect(approved.item.binding.sessionId).toBe(receiver.id);
    const duplicate = await request.post(instance.endpoint + '/api/desktop/plans', { headers, data: { action: 'approve', planId, expectedVersion: before.execution.version, sessionId: source.id, mode: 'manual' } });
    expect(duplicate.ok()).toBe(false);
    await expect.poll(async () => (await read()).execution.status, { timeout: 120000 }).toBe('waiting_for_user');
    const waiting = await read();
    expect(waiting.tasks.flatMap((task: any) => task.steps).filter((step: any) => step.status === 'completed')).toHaveLength(31);
    expect(waiting.execution.sourceUiSessionId).toBe(source.id);
    expect(waiting.binding.sessionId).toBe(receiver.id);
    expect(instance.model.requests.slice(requestBaseline).filter(value => value.matched === 'plan-step')).toHaveLength(31);
    const accepted = await post('/api/desktop/plans', { action: 'complete', planId, expectedVersion: waiting.execution.version, actionId: `accept-${token}` });
    await expect.poll(async () => (await read()).execution.status).toBe('completed');
    const receiverState = await (await request.get(instance.endpoint + `/api/sessions/${receiver.id}?profileId=default&userId=receiver-${token}`)).json();
    expect(JSON.stringify(receiverState)).toContain('Verified the local fixture item.');
    expect(accepted.item.execution.status).not.toBe('running');
  } finally {
    await post('/api/stream/stop', { profileId: 'default', conversationId: receiver.id, userId: `receiver-${token}` });
    instance.model.release(token); await busyBody;
  }
});

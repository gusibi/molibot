import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';
import { modelRequestMatchers } from './support/model-service';

test('final answer remains visible after first open, session switch and isolated restart @chat @recovery', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const final = `RESULT:${marker} This is the complete answer.`;
  const script = replyTo(instance.model, marker, { type: 'text', text: final });
  await sendText(page, marker);
  await expectReply(page, final);
  await expect(page.locator('.turn-process')).toHaveCount(0);
  expect(instance.model.matched(script.name)).toHaveLength(1);
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(marker) }).click();
  await expectReply(page, final);
  await instance.stopService();
  await instance.startService();
  await page.reload();
  await expectReply(page, final);
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 480, height: 760 });
  await page.reload();
  await expectReply(page, final);
});

test('approval progress is never delivered as the answer @chat @approval', async ({ page, request, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const progress = `WAITING_PROCESS:${marker}`;
  const script = instance.model.script({
    name: `pending-${marker}`,
    when: value => modelRequestMatchers(value).lastUserText.includes(marker) && !modelRequestMatchers(value).afterToolResults,
    reply: { type: 'toolCalls', text: progress, calls: [
      { name: 'write', args: { label: 'Save pending file', path: `pending-${marker}.txt`, content: 'must wait' } }
    ] }
  });
  const final = `DECLINED:${marker} No file was written.`;
  instance.model.script({ name: `declined-${marker}`, when: value => modelRequestMatchers(value).lastUserText.includes(marker) && modelRequestMatchers(value).afterToolResults, reply: { type: 'text', text: final } });
  const response = page.waitForResponse(value => value.url().endsWith('/api/stream') && value.request().method() === 'POST');
  await sendText(page, marker);
  await expect(page.getByTestId('decision-card')).toBeVisible();
  const stream = await response;
  const admitted = stream.request().postDataJSON();
  const snapshot = await request.get(`${instance.endpoint}/api/sessions/${admitted.conversationId}?profileId=default`);
  expect(snapshot.ok()).toBe(true);
  const messages = (await snapshot.json()).session.messages;
  const assistant = messages.find((message: { role: string }) => message.role === 'assistant');
  expect(assistant.content).toBe('');
  expect(assistant.resultKind).toBe('none');
  await expect(page.getByText(progress, { exact: true })).toHaveCount(0);
  const process = page.locator('.turn-process').last();
  await expect(process).not.toHaveAttribute('open');
  await process.locator('summary').first().click();
  await expect(page.getByText(progress, { exact: true })).toBeVisible();
  await page.getByTestId('decision-card').getByRole('button', { name: /Deny|Reject/ }).click();
  await expectReply(page, final);
  const done = (await stream.text()).split('\n\n').find(frame => frame.startsWith('event: done\n'));
  expect(done).toBeTruthy();
  expect(JSON.parse(done!.split('\ndata: ')[1]).response).toBe(final);
  expect(instance.model.matched(script.name)).toHaveLength(1);
  const files = await readdir(instance.dataDir, { recursive: true });
  expect(files.some(path => path.endsWith(`pending-${marker}.txt`))).toBe(false);
});

test('ten tools share one collapsed process and only the final answer is visible @chat', async ({ page, request, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, `start-${marker}`, { type: 'text', text: `READY:${marker}` });
  const firstRequest = page.waitForRequest(value => value.method() === 'POST' && value.url().includes('/api/stream') && !value.url().includes('/api/stream/'));
  await sendText(page, `start-${marker}`);
  const admitted = (await firstRequest).postDataJSON();
  await expectReply(page, `READY:${marker}`);
  const permission = await request.post(instance.endpoint + '/api/desktop/session-permission', {
    headers: { origin: instance.endpoint }, data: { profileId: 'default', conversationId: admitted.conversationId, mode: 'auto' }
  });
  expect(permission.ok(), await permission.text()).toBe(true);
  const progress = `PROCESS_ONLY:${marker}`;
  const final = `FINAL:${marker} All ten files were saved. Keep this configuration. Change the frequency?`;
  const before = instance.model.script({
    name: `tools-${marker}`,
    when: value => modelRequestMatchers(value).lastUserText.includes(`work-${marker}`) && !modelRequestMatchers(value).afterToolResults,
    reply: { type: 'toolCalls', text: progress, calls: Array.from({ length: 10 }, (_, index) => ({
      name: 'write', id: `save-${marker}-${index}`, args: { label: `Save ${index}`, path: `answer-${marker}-${index}.txt`, content: `saved:${index}` }
    })) }
  });
  const after = instance.model.script({
    name: `final-${marker}`,
    when: value => modelRequestMatchers(value).lastUserText.includes(`work-${marker}`) && modelRequestMatchers(value).afterToolResults,
    reply: value => {
      expect(value.system.split('<answer-delivery>')).toHaveLength(2);
      expect(value.messages.filter(message => message.role === 'tool')).toHaveLength(10);
      return { type: 'hold', text: final, key: marker };
    }
  });
  await sendText(page, `work-${marker}`);
  const process = page.locator('.streaming-message .turn-process');
  await expect(process).toHaveCount(1);
  await expect(process).not.toHaveAttribute('open');
  await expect(page.getByText(progress, { exact: true })).toHaveCount(0);
  await process.locator('summary').first().click();
  await expect(page.getByText(progress, { exact: true })).toBeVisible();
  await process.locator('summary').first().click();
  instance.model.release(marker);
  await expectReply(page, final);
  const completed = page.locator('article').filter({ hasText: final }).last();
  await expect(completed.locator('.turn-process')).toHaveCount(1);
  await expect(completed.locator('.turn-process')).not.toHaveAttribute('open');
  await expect(page.getByText(progress, { exact: true })).toHaveCount(0);
  expect(instance.model.matched(before.name)).toHaveLength(1);
  expect(instance.model.matched(after.name)).toHaveLength(1);
  const files = await readdir(instance.dataDir, { recursive: true });
  for (let index = 0; index < 10; index++) {
    const saved = files.filter(path => path.endsWith(`answer-${marker}-${index}.txt`));
    expect(saved).toHaveLength(1);
    expect(await readFile(join(instance.dataDir, saved[0]), 'utf8')).toBe(`saved:${index}`);
  }
  await page.reload();
  await expectReply(page, final);
  await expect(page.getByText(progress, { exact: true })).toHaveCount(0);
  const history = page.locator('article').filter({ hasText: final }).last();
  await history.locator('.turn-process summary').first().click();
  await expect(page.getByText(progress, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('final-answer-process.png') });
});

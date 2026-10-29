import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';
import { modelRequestMatchers } from './support/model-service';

test('thinking and tools form one flat chronological timeline @chat', async ({ page, request, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, `timeline-start-${marker}`, { type: 'text', text: `READY:${marker}` });
  const first = page.waitForRequest(value => value.method() === 'POST' && value.url().endsWith('/api/stream'));
  await sendText(page, `timeline-start-${marker}`);
  const admitted = (await first).postDataJSON();
  await expectReply(page, `READY:${marker}`);
  const permission = await request.post(instance.endpoint + '/api/desktop/session-permission', {
    headers: { origin: instance.endpoint }, data: { profileId: 'default', conversationId: admitted.conversationId, mode: 'auto' }
  });
  expect(permission.ok(), await permission.text()).toBe(true);
  const thoughts = [`CHECK_A:${marker}`, `CHECK_B:${marker}`, `CHECK_C:${marker}`];
  const progress = [`PROGRESS_A:${marker}`, `PROGRESS_B:${marker}`];
  const labels = [`Save first ${marker}`, `Save second ${marker}`];
  const final = `RESULT:${marker} Both files were saved and verified.`;
  const flow = instance.model.script({
    name: `timeline-${marker}`,
    when: value => modelRequestMatchers(value).lastUserText.includes(`timeline-work-${marker}`),
    reply: value => {
      const lastUser = value.messages.findLastIndex(message => message.role === 'user');
      const completed = value.messages.slice(lastUser + 1).filter(message => message.role === 'tool').length;
      return completed < 2 ? {
        type: 'toolCalls', thinking: thoughts[completed], text: progress[completed], calls: [{
          name: 'write', id: `timeline-${marker}-${completed}`,
          args: { label: labels[completed], path: `timeline-${marker}-${completed}.txt`, content: `verified:${completed}` }
        }]
      } : { type: 'thinking', thinking: thoughts[2], text: final, key: marker };
    }
  });
  await sendText(page, `timeline-work-${marker}`);
  const live = page.locator('.streaming-message .turn-process');
  await expect(live).toHaveCount(1);
  await expect(live).not.toHaveAttribute('open');
  await live.locator('summary').first().click();
  await expect(live.getByText(thoughts[2], { exact: true })).toBeVisible();
  await expect(live.locator('.thinking-card')).toHaveCount(0);
  const expected = [thoughts[0], progress[0], labels[0], thoughts[1], progress[1], labels[1], thoughts[2]];
  async function expectOrder(container: typeof live) {
    const items = container.getByRole('listitem');
    await expect(items).toHaveCount(expected.length);
    for (let index = 0; index < expected.length; index++) await expect(items.nth(index)).toContainText(expected[index]);
  }
  await expectOrder(live);
  instance.model.release(marker);
  await expectReply(page, final);
  const history = page.locator('article').filter({ hasText: final }).last();
  const process = history.locator('.turn-process');
  await expect(process).toHaveCount(1);
  await expect(process).not.toHaveAttribute('open');
  await process.locator('summary').first().click();
  await expectOrder(process);
  await expect(process.getByText(final, { exact: true })).toHaveCount(0);
  await expect(history.getByText(final, { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('timeline-wide.png') });
  expect(instance.model.matched(flow.name)).toHaveLength(3);
  const files = await readdir(instance.dataDir, { recursive: true });
  for (let index = 0; index < 2; index++) {
    const matches = files.filter(path => path.endsWith(`timeline-${marker}-${index}.txt`));
    expect(matches).toHaveLength(1);
    expect(await readFile(join(instance.dataDir, matches[0]), 'utf8')).toBe(`verified:${index}`);
  }
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(marker) }).click();
  await expectReply(page, final);
  await instance.restartService();
  await page.reload();
  await expectReply(page, final);
  await expect(process).not.toHaveAttribute('open');
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 480, height: 760 });
  await page.reload();
  await process.locator('summary').first().click();
  await expectOrder(process);
  await expect(process.locator('.thinking-card')).toHaveCount(0);
  await expectReply(page, final);
  await page.screenshot({ path: testInfo.outputPath('timeline-dark-narrow.png') });
});

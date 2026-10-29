import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat, replyTo, sendText, expectReply } from './support/actions';

test('header Agent name returns to its home without creating a session @chat @navigation', async ({ page, instance }, testInfo) => {
  // Other workspace edits must not hot-reload this isolated navigation scenario.
  await page.routeWebSocket(url => url.searchParams.has('token'), () => {});
  const key = randomUUID().slice(0, 8);
  const title = `Agent home link ${key}`;
  const sessionId = `home-link-${key}`;
  const directory = join(instance.dataDir, 'sessions', 'ui-second', 'contexts');
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(directory, `${sessionId}.jsonl`), [
    { type: 'session', version: 1, id: sessionId, timestamp },
    { type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: title }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `REPLY:${title}` }] } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  await writeFile(join(directory, `${sessionId}.meta.json`), JSON.stringify({ agentId: 'ui-second', source: { channel: 'feishu', botId: 'home-link-bot', chatId: 'home-link-chat', sessionId }, display: { title, createdAt: timestamp, updatedAt: timestamp, hasMessages: true, eventPrompt: false } }));
  await openChat(page);
  const webTitle = `Momo home link ${key}`;
  replyTo(instance.model, webTitle, { type: 'text', text: `REPLY:${webTitle}` });
  await sendText(page, webTitle);
  await expectReply(page, `REPLY:${webTitle}`);
  const header = page.locator('.chat-header');
  const momoHome = header.getByRole('button', { name: 'Open Momo home', exact: true });
  await expect(momoHome).toHaveText('Momo');
  await expect(momoHome).not.toHaveAttribute('data-tauri-drag-region');
  await momoHome.click();
  await expect(page.locator('.agent-home').getByRole('heading', { name: 'Momo', exact: true })).toBeVisible();
  await expect(header.locator('.chat-agent-label')).toHaveCount(0);

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByText(`REPLY:${title}`, { exact: true })).toBeVisible();
  const recordsBefore = await readdir(directory);
  await page.evaluate(() => {
    document.documentElement.dataset.resolvedAppearance = 'dark';
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
  });
  await page.setViewportSize({ width: 560, height: 760 });
  const secondHome = header.getByRole('button', { name: '打开 UI Second 首页', exact: true });
  await expect(secondHome).toBeVisible();
  await secondHome.focus();
  await expect(secondHome).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('agent-home-link.png') });
  await page.keyboard.press('Enter');
  await expect(page.locator('.agent-home').getByRole('heading', { name: 'UI Second', exact: true })).toBeVisible();
  expect(await readdir(directory)).toEqual(recordsBefore);
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await instance.restartService();
  await page.reload();
  const restoredHome = header.getByRole('button', { name: 'Open UI Second home', exact: true });
  await expect(restoredHome).toBeVisible();
  await restoredHome.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.agent-home').getByRole('heading', { name: 'UI Second', exact: true })).toBeVisible();
  expect(await readdir(directory)).toEqual(recordsBefore);
});

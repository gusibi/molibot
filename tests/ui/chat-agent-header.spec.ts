import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { composer, openChat, sendText, expectReply, replyTo } from './support/actions';

test('chat header identifies the Agent and opens scoped history; external refresh stays in the footer @chat @navigation', async ({ page, request, instance }, testInfo) => {
  const key = randomUUID().slice(0, 8);
  const externalTitle = `External history ${key}`;
  const sessionId = `header-${key}`;
  const dir = join(instance.dataDir, 'sessions', 'ui-second', 'contexts');
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'session', version: 1, id: sessionId, timestamp },
    { type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: externalTitle }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `External reply ${key}` }] } }
  ];
  await writeFile(join(dir, `${sessionId}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await writeFile(join(dir, `${sessionId}.meta.json`), JSON.stringify({ agentId: 'ui-second', source: { channel: 'feishu', botId: 'header-bot', chatId: 'header-chat', sessionId }, display: { title: externalTitle, createdAt: timestamp, updatedAt: timestamp, hasMessages: true, eventPrompt: false } }));
  await openChat(page);
  const webTitle = `Web header ${key}`;
  replyTo(instance.model, webTitle, { type: 'text', text: `REPLY:${webTitle}` });
  await sendText(page, webTitle);
  await expectReply(page, `REPLY:${webTitle}`);
  const header = page.locator('.chat-header');
  await expect(header.locator('.chat-agent-label')).toHaveText('Momo');
  await expect(page.getByRole('button', { name: 'Refresh conversations', exact: true })).toHaveCount(0);
  await header.getByRole('button', { name: 'Agent conversations', exact: true }).click();
  const history = page.getByRole('region', { name: 'Search conversations', exact: true });
  await expect(history.getByRole('button', { name: new RegExp(webTitle) })).toBeVisible();
  await expect(history.getByRole('button', { name: new RegExp(externalTitle) })).toHaveCount(0);
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(externalTitle) }).click();
  await expect(header.locator('.chat-agent-label')).toHaveText('UI Second');
  await expect(header.locator('.chat-source-label')).toHaveText('Feishu');
  await expect(composer(page)).toHaveCount(0);
  const refresh = page.getByRole('button', { name: 'Refresh conversations', exact: true });
  await expect(header.getByRole('button', { name: 'Refresh conversations', exact: true })).toHaveCount(0);
  await expect(page.locator('.external-readonly-notice').getByRole('button', { name: 'Refresh conversations', exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(response => response.url().includes('/api/desktop/external-sessions/') && response.request().method() === 'GET');
  await refresh.click();
  expect((await refreshed).ok()).toBe(true);
  await expect(page.getByText(`External reply ${key}`, { exact: true })).toBeVisible();
  await header.getByRole('button', { name: 'Agent conversations', exact: true }).click();
  await expect(history.getByRole('button', { name: new RegExp(externalTitle) })).toBeVisible();
  await expect(history.getByRole('button', { name: new RegExp(webTitle) })).toHaveCount(0);
  await history.getByRole('button', { name: new RegExp(externalTitle) }).click();
  for (const [locale, appearance] of [['en-US', 'light'], ['zh-CN', 'dark']]) {
    await page.evaluate(({ locale, appearance }) => {
      document.documentElement.dataset.resolvedAppearance = appearance;
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, appearance });
    await page.setViewportSize({ width: 860, height: 760 });
    await expect(header.getByRole('button', { name: locale === 'zh-CN' ? 'Agent 全部对话' : 'Agent conversations', exact: true })).toBeVisible();
    await expect(page.locator('.external-readonly-notice').getByRole('button', { name: locale === 'zh-CN' ? '刷新对话' : 'Refresh conversations', exact: true })).toBeVisible();
    expect(await header.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath('external-footer-refresh.png') });
  await instance.restartService();
  await page.reload();
  await expect(header.locator('.chat-agent-label')).toHaveText('UI Second');
  await expect(page.locator('.external-readonly-notice').getByRole('button', { name: 'Refresh conversations', exact: true })).toBeVisible();
  expect((await request.get(instance.endpoint + '/api/desktop/conversations?channel=feishu&agentId=ui-second&includeArchived=true')).ok()).toBe(true);
});

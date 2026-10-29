import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { composer, openChat, sendText, expectReply, replyTo } from './support/actions';


async function expectHeaderLayout(page: Page, aligned = true) {
  const header = page.locator('.chat-header');
  await expect.poll(() => header.evaluate(element => {
    const title = element.querySelector('.chat-title-block')!.getBoundingClientRect();
    const actions = element.querySelector('.header-actions')!.getBoundingClientRect();
    const labels = [...element.querySelectorAll('.chat-title-name, .chat-agent-label, .chat-source-label')];
    const buttons = [...element.querySelectorAll('.header-actions .icon-button')];
    const right = element.getBoundingClientRect().right;
    return {
      titleFits: title.right <= actions.left,
      labelsFit: labels.every(label => label.getBoundingClientRect().right <= actions.left),
      buttonsFit: buttons.every(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.width >= 27.5 && bounds.left >= actions.left && bounds.right <= right;
      })
    };
  })).toEqual({ titleFits: true, labelsFit: true, buttonsFit: true });
  if (aligned) {
    await expect.poll(() => header.evaluate(element => {
      const page = element.querySelector('.window-header-page')!.getBoundingClientRect();
      const content = document.querySelector('.workspace-main')!.getBoundingClientRect();
      return Math.abs(page.left - content.left);
    })).toBeLessThan(1);
  }
  expect(await header.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
}

test('chat header identifies the Agent and opens scoped history; external refresh stays in the footer @chat @navigation', async ({ page, request, instance }, testInfo) => {
  const key = randomUUID().slice(0, 8);
  const externalTitle = `《穷查理宝典》（查理·芒格）——多元思维模型与长期决策 External history ${key}`;
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
    for (const width of [1120, 820, 720, 560]) {
      await page.setViewportSize({ width, height: 760 });
      await expectHeaderLayout(page);
    }
    await page.setViewportSize({ width: 1120, height: 760 });
    const files = header.getByRole('button', { name: locale === 'zh-CN' ? '文件' : 'Files', exact: true });
    await files.click();
    await expect(page.locator('.workspace-inspector')).toBeVisible();
    await expectHeaderLayout(page);
    await page.setViewportSize({ width: 820, height: 760 });
    await expectHeaderLayout(page);
    await files.click();
    await header.getByRole('button', { name: locale === 'zh-CN' ? '折叠侧边栏' : 'Collapse sidebar', exact: true }).click();
    await page.setViewportSize({ width: 560, height: 760 });
    await expectHeaderLayout(page, false);
    await header.getByRole('button', { name: locale === 'zh-CN' ? '展开侧边栏' : 'Expand sidebar', exact: true }).click();
    await expect(header.getByRole('button', { name: locale === 'zh-CN' ? 'Agent 全部对话' : 'Agent conversations', exact: true })).toBeVisible();
    await expect(page.locator('.external-readonly-notice').getByRole('button', { name: locale === 'zh-CN' ? '刷新对话' : 'Refresh conversations', exact: true })).toBeVisible();
    expect(await header.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath('external-footer-refresh.png') });
  await instance.restartService();
  await page.reload();
  await expect(header.locator('.chat-agent-label')).toHaveText('UI Second');
  await expect(page.locator('.external-readonly-notice').getByRole('button', { name: 'Refresh conversations', exact: true })).toBeVisible();
  await expectHeaderLayout(page);
  expect((await request.get(instance.endpoint + '/api/desktop/conversations?channel=feishu&agentId=ui-second&includeArchived=true')).ok()).toBe(true);
});

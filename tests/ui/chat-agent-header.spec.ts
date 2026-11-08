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

test('chat header identifies the Agent, monitors context, and opens scoped history; external refresh stays in the footer @chat @navigation', async ({ page, request, instance }, testInfo) => {
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
  const contextTrigger = header.getByRole('button', { name: 'Context window', exact: true });
  await contextTrigger.click();
  const contextPanel = page.locator('.context-window-popover');
  await expect(contextPanel.getByRole('heading', { level: 3, name: 'Context Window' })).toBeVisible();
  await expect(contextPanel).toContainText('Used context');
  await expect(contextPanel).toContainText('Remaining space');
  await expect(contextPanel.locator('.context-window-block[data-key="remaining"]')).toBeVisible();
  await expect(contextPanel).toContainText('Tools');
  const contextScreenshot = testInfo.outputPath('context-window.png');
  await page.screenshot({ path: contextScreenshot });
  await testInfo.attach('context-window', { path: contextScreenshot, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect(contextPanel).toHaveCount(0);
  await header.getByRole('button', { name: 'Agent conversations', exact: true }).click();
  const history = page.getByRole('region', { name: 'Search conversations', exact: true });
  await expect(history.getByRole('button', { name: new RegExp(webTitle) })).toBeVisible();
  await expect(history.getByRole('button', { name: new RegExp(externalTitle) })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
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
  await history.getByRole('button', { name: 'Filter by scope', exact: true }).click();
  await page.getByRole('option', { name: 'Web', exact: true }).click();
  await expect(history.getByText('No conversations', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Filter by scope', exact: true }).click();
  await page.getByRole('option', { name: 'Feishu', exact: true }).click();
  await history.getByRole('button', { name: new RegExp(externalTitle) }).click();
  await expect(history).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
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
    await expect(header.getByRole('button', { name: locale === 'zh-CN' ? '上下文窗口' : 'Context window', exact: true })).toBeVisible();
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


test('history drawer overlays the conversation and supports repeated session switches @chat @navigation', async ({ page, instance }, testInfo) => {
  await openChat(page);
  const key = randomUUID().slice(0, 8);
  const titles = [`First session ${key}`, `Second session ${key}`];
  for (const title of titles) {
    replyTo(instance.model, title, { type: 'text', text: `REPLY:${title}` });
    await sendText(page, title);
    await expectReply(page, `REPLY:${title}`);
    if (title === titles[0]) await page.locator('.chat-header .chat-agent-label').click();
  }
  const directory = join(instance.dataDir, 'sessions', 'default', 'contexts');
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < 11; index++) {
    const sessionId = `panel-${key}-${index}`;
    const timestamp = new Date(Date.now() - 60_000 - index * 1000).toISOString();
    const title = `Older conversation ${key} ${index}`;
    await writeFile(join(directory, `${sessionId}.jsonl`), [
      { type: 'session', version: 1, id: sessionId, timestamp },
      { type: 'message', id: 'u1', timestamp, message: { role: 'user', content: [{ type: 'text', text: title }] } }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    await writeFile(join(directory, `${sessionId}.meta.json`), JSON.stringify({ agentId: 'default', source: { channel: 'feishu', botId: 'panel-bot', chatId: 'panel-chat', sessionId }, display: { title, createdAt: timestamp, updatedAt: timestamp, hasMessages: true, eventPrompt: false } }));
  }
  const header = page.locator('.chat-header');
  const trigger = header.getByRole('button', { name: 'Agent conversations', exact: true, includeHidden: true });
  await composer(page).fill('Keep my unsent draft');
  const beforeHistory = await page.locator('.workspace-main').boundingBox();
  await trigger.click();
  const drawer = page.locator('.session-history-drawer');
  await expect(page.getByRole('dialog', { name: 'History', exact: true })).toBeVisible();
  expect(await page.locator('.workspace-main').boundingBox()).toEqual(beforeHistory);
  await expect(page.locator('.workspace-inspector')).toHaveCount(0);
  const history = drawer.getByRole('region', { name: 'Search conversations', exact: true });
  await expect(history).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expectReply(page, `REPLY:${titles[1]}`);
  await expect(composer(page)).toHaveValue('Keep my unsent draft');
  await expect(page.locator('.agent-history-page')).toHaveCount(0);
  const first = history.getByRole('button', { name: new RegExp(titles[0]) });
  const second = history.getByRole('button', { name: new RegExp(titles[1]) });
  await expect(second).toHaveAttribute('aria-current', 'true');
  const oldest = history.getByRole('button', { name: new RegExp(`Older conversation ${key} 10`) });
  await expect(oldest).toHaveCount(0);
  await history.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(oldest).toBeVisible();
  await oldest.click();
  await expect(page.locator('.external-readonly-notice')).toBeVisible();
  await expect(history).toBeVisible();
  await expect(oldest).toHaveAttribute('aria-current', 'true');
  await expect(composer(page)).toHaveCount(0);
  await second.click();
  await expectReply(page, `REPLY:${titles[1]}`);
  await expect(composer(page)).toHaveValue('Keep my unsent draft');
  await first.click();
  await expectReply(page, `REPLY:${titles[0]}`);
  await expect(first).toHaveAttribute('aria-current', 'true');
  await second.click();
  await expectReply(page, `REPLY:${titles[1]}`);
  await expect(composer(page)).toHaveValue('Keep my unsent draft');
  await expect(second).toHaveAttribute('aria-current', 'true');
  const search = history.getByRole('textbox', { name: 'Search conversations', exact: true });
  await search.fill(`missing-${key}`);
  await expect(history.getByText('No conversations found', { exact: true })).toBeVisible();
  await search.fill(titles[0]);
  await expect(first).toBeVisible();
  await expect(second).toHaveCount(0);
  await search.fill('');
  await expect(second).toBeVisible();
  await page.route('**/api/desktop/conversations/search?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'History temporarily unavailable' }) }));
  await search.fill('failed-search');
  await expect(history.getByRole('alert')).toContainText('History temporarily unavailable');
  await expectReply(page, `REPLY:${titles[1]}`);
  await page.unroute('**/api/desktop/conversations/search?**');
  await search.fill('');
  await expect(history.getByRole('alert')).toHaveCount(0);
  await expect(second).toBeVisible();
  for (const [locale, appearance] of [['zh-CN', 'dark'], ['en-US', 'light']]) {
    await page.evaluate(({ locale, appearance }) => {
      document.documentElement.dataset.resolvedAppearance = appearance;
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, appearance });
    for (const width of [860, 1440]) {
      await page.setViewportSize({ width, height: 760 });
      const panel = page.locator('.session-history-list');
      await expect(panel).toBeVisible();
      expect(await panel.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
      await expectHeaderLayout(page);
    }
  }
  await page.setViewportSize({ width: 1120, height: 760 });
  await expectHeaderLayout(page);
  await page.screenshot({ path: testInfo.outputPath('session-history-panel.png') });
  await search.press('Escape');
  await expect(history).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(second).toBeVisible();
  await page.mouse.click(12, 400);
  await expect(history).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await header.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('.workspace-inspector')).toBeVisible();
  const withFiles = await page.locator('.workspace-main').boundingBox();
  await trigger.click();
  await expect(second).toBeVisible();
  await expect(page.locator('.artifact-panel')).toHaveCount(1);
  expect(await page.locator('.workspace-main').boundingBox()).toEqual(withFiles);
  await instance.restartService();
  const recovered = page.waitForResponse(response => response.url().includes('/api/desktop/conversations/search?') && response.url().includes('query='));
  await search.fill(titles[1]);
  expect((await recovered).ok()).toBe(true);
  await expect(second).toBeVisible();
  await search.fill('');
  await expect(first).toBeVisible();
  await first.click();
  await expectReply(page, `REPLY:${titles[0]}`);
  await page.evaluate(() => { delete document.documentElement.dataset.performance; });
  await search.press('Escape');
  await expect(history).toHaveCount(0);
  await trigger.click();
  await expect(history).toBeVisible();
  expect(await drawer.evaluate(element => getComputedStyle(element).animationName)).toBe('drawer-in');
  await history.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(history).toHaveCount(0);
  await expectReply(page, `REPLY:${titles[0]}`);
  await trigger.click();
  await expect(history).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
  await page.locator('.chat-header .chat-agent-label').click();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(history).toHaveCount(0);
});

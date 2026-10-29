import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat, replyTo, sendText, expectReply } from './support/actions';

test('session more menu reuses session actions and survives reconnect @chat @navigation', async ({ page, context, request, instance }, testInfo) => {
  // Ignore Vite reloads from unrelated edits in the shared workspace.
  await page.routeWebSocket(url => url.searchParams.has('token'), () => {});
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const key = randomUUID().slice(0, 8);
  const title = `Session actions ${key}`;
  const sessionId = `actions-${key}`;
  const directory = join(instance.dataDir, 'sessions', 'ui-second', 'contexts');
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(directory, `${sessionId}.jsonl`), [
    { type: 'session', version: 1, id: sessionId, timestamp },
    { type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: title }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `REPLY:${title}` }] } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  await writeFile(join(directory, `${sessionId}.meta.json`), JSON.stringify({ agentId: 'ui-second', source: { channel: 'feishu', botId: 'actions-bot', chatId: 'actions-chat', sessionId }, display: { title, createdAt: timestamp, updatedAt: timestamp, hasMessages: true, eventPrompt: false } }));
  await openChat(page);
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByText(`REPLY:${title}`, { exact: true })).toBeVisible();
  const header = page.locator('.chat-header');
  const more = header.getByRole('button', { name: 'More conversation actions', exact: true });
  await expect(more).toBeVisible();
  await expect(header.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveCount(4);
  await menu.getByRole('menuitem', { name: 'Search this conversation', exact: true }).click();
  const search = header.getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.fill(title);
  await expect(header.locator('.search-count')).toContainText('1/');
  await more.click();
  await menu.getByRole('menuitem', { name: 'Search this conversation', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(title);
  await header.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(more).toBeFocused();
  await more.click();
  const response = page.waitForResponse(res => res.url().includes('/api/desktop/conversations/path?'));
  await menu.getByRole('menuitem', { name: 'Copy session directory path', exact: true }).click();
  const pathResponse = await response;
  expect(new URL(pathResponse.url()).searchParams.get('target')).toBe('directory');
  const path = (await pathResponse.json()).path;
  expect(path).toBe(directory);
  expect((await stat(path)).isDirectory()).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
  const encodedSessionId = new URL(pathResponse.url()).searchParams.get('sessionId')!;
  const file = await request.get(`${instance.endpoint}/api/desktop/conversations/path?sessionId=${encodeURIComponent(encodedSessionId)}`);
  expect(dirname((await file.json()).path)).toBe(path);
  expect((await request.get(`${instance.endpoint}/api/desktop/conversations/path?sessionId=missing&target=directory`)).status()).toBe(404);
  expect((await request.get(`${instance.endpoint}/api/desktop/conversations/path?sessionId=${encodeURIComponent(encodedSessionId)}&target=invalid`)).status()).toBe(400);
  // Finder is simulated so the test never opens an OS window.
  await page.route('**/api/desktop/conversations/reveal', route => {
    expect(route.request().postDataJSON()).toMatchObject({ sessionId: encodedSessionId, target: 'directory' });
    return route.fulfill({ json: { ok: true, path } });
  });
  await more.click();
  const reveal = page.waitForResponse(res => res.url().endsWith('/api/desktop/conversations/reveal'));
  await menu.getByRole('menuitem', { name: 'Open directory in Finder', exact: true }).click();
  expect((await reveal).ok()).toBe(true);
  for (const [locale, appearance] of [['zh-CN', 'dark'], ['en-US', 'light']]) {
    await page.evaluate(({ locale, appearance }) => {
      document.documentElement.dataset.resolvedAppearance = appearance;
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, appearance });
    await page.setViewportSize({ width: 560, height: 760 });
    await header.getByRole('button', { name: locale === 'zh-CN' ? '更多会话操作' : 'More conversation actions' }).click();
    await expect(menu.getByRole('menuitem', { name: locale === 'zh-CN' ? '复制会话目录路径' : 'Copy session directory path' })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
    await page.screenshot({ path: testInfo.outputPath(`session-actions-${locale}.png`) });
    await page.keyboard.press('Escape');
  }
  await instance.restartService();
  await page.reload();
  await more.click();
  const refused = page.waitForResponse(res => res.url().endsWith('/api/sessions/managed/bulk'));
  await menu.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
  expect((await (await refused).json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ conversationId: encodedSessionId, status: 'skipped' })]));
  await expect(page.getByText(/external sessions are read-only/)).toBeVisible();
  await expect(page.getByText(`REPLY:${title}`, { exact: true })).toBeVisible();

  const expand = header.getByRole('button', { name: 'Expand sidebar', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  const webTitle = `Web actions ${key}`;
  replyTo(instance.model, webTitle, { type: 'text', text: `REPLY:${webTitle}` });
  await sendText(page, webTitle);
  await expectReply(page, `REPLY:${webTitle}`);
  await more.click();
  await page.route('**/api/sessions/managed/bulk', route => route.fulfill({ status: 503, json: { error: 'Deletion unavailable' } }));
  const failed = page.waitForRequest(req => req.url().endsWith('/api/sessions/managed/bulk'));
  await menu.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
  const webSessionId = (await failed).postDataJSON().targets[0].conversationId;
  await expect(page.getByText(/Deletion unavailable/)).toBeVisible();
  await expect(page.getByText(`REPLY:${webTitle}`, { exact: true })).toBeVisible();
  await page.unroute('**/api/sessions/managed/bulk');
  await more.click();
  const deleted = page.waitForResponse(res => res.url().endsWith('/api/sessions/managed/bulk'));
  await menu.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
  expect((await (await deleted).json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ conversationId: webSessionId, status: 'succeeded' })]));
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(more).toHaveCount(0);
  const remaining = await request.get(`${instance.endpoint}/api/desktop/conversations?agentId=default&includeArchived=true`);
  expect((await remaining.json()).items.some((item: {sessionId: string}) => item.sessionId === webSessionId)).toBe(false);
});

import { test, expect } from './support/fixtures';
import { openChat, openSettings, sendText, expectReply, replyTo, uniqueToken } from './support/actions';

test('completion of the visible conversation is read without reopening it', async ({ page, request, instance }) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  await instance.restartService();
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, marker, { type: 'text', text: `DONE:${marker}` });
  await sendText(page, marker);
  await expectReply(page, `DONE:${marker}`);
  const list = async () => (await (await request.get(`${instance.endpoint}/api/desktop/notifications?status=all&limit=200`)).json()).notifications;
  await expect.poll(async () => (await list()).filter((n: any) => n.type === 'session-completed' && n.payload.title?.includes(marker)).map((n: any) => n.status)).toEqual(['read']);
  // A reply completed while Settings covers the chat remains unread.
  const background = uniqueToken();
  replyTo(instance.model, background, { type: 'thinking', thinking: 'Waiting', text: `BACKGROUND:${background}`, key: background });
  await sendText(page, background);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await openSettings(page);
  instance.model.release(background);
  await expect.poll(async () => (await list()).filter((n: any) => n.type === 'session-completed' && n.payload.preview?.includes(background)).map((n: any) => n.status)).toEqual(['unread']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(async () => (await list()).filter((n: any) => n.type === 'session-completed' && n.payload.preview?.includes(background)).map((n: any) => n.status)).toEqual(['read']);
  await instance.restartService();
  await page.reload();
  await expectReply(page, `BACKGROUND:${background}`);
});

test('discovered models keep added and new actions on the same row', async ({ page }, testInfo) => {
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'AI Providers', exact: true }).click();
  await page.getByRole('tab', { name: 'Self-hosted providers', exact: true }).click();
  await page.locator('.provider-rail-list').getByRole('button', { name: /UI Test/ }).click();
  await page.route('**/api/desktop/provider-models', route => route.fulfill({ json: { ok: true, models: ['fixture', 'new-model'], items: [
    { id: 'fixture', alias: 'UI Model', tags: ['vision'], contextWindow: 100000 },
    { id: 'new-model', alias: 'New Model', tags: ['vision'], contextWindow: 100000 }
  ] } }));
  await page.locator('.provider-models-block .provider-models-tools button').first().click();
  const rows = page.locator('.provider-model-discovery-body .provider-model-row');
  await expect(rows).toHaveCount(2);
  const aligned = () => rows.evaluateAll(nodes => nodes.every(row => {
    const button = row.querySelector('button')!.getBoundingClientRect();
    const name = row.querySelector('.provider-model-name')!.getBoundingClientRect();
    return Math.abs(button.y + button.height / 2 - name.y - name.height / 2) < 2 && button.right <= row.getBoundingClientRect().right;
  }));
  expect(await aligned()).toBe(true);
  await page.setViewportSize({ width: 860, height: 620 });
  expect(await aligned()).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("models-aligned.png") });
});

test('context polling keeps its DOM during live/idle refresh and failed requests', async ({ page, instance }, testInfo) => {
  await openChat(page);
  let hold = false;
  await page.route('**/api/sessions/fixture?*', async route => {
    if (hold) return route.fulfill({ status: 503, json: { ok: false } });
    return route.fulfill({ json: { ok: true, session: { messages: [{ role: 'assistant', content: 'snapshot', usage: { inputTokens: 200, outputTokens: 20 } }] } } });
  });
  await page.evaluate(async endpoint => {
    const harnessModule = '/src/lib/chat/contextWindowPanel.browser-fixture.ts';
    const { mountContextPanel } = await import(harnessModule);
    const target = document.createElement('div');
    target.id = 'context-regression';
    document.body.append(target);
    const panel = mountContextPanel(target, endpoint);
    (window as any).setContextLive = panel.setLive;

  }, instance.endpoint);
  await page.locator('#context-regression button').click();
  const map = page.locator('.context-window-map');
  await expect(map).toBeVisible();
  await map.evaluate(node => (window as any).contextMapNode = node);
  hold = true;
  await page.evaluate(() => (window as any).setContextLive());
  await expect(page.locator('.context-window-header [role=status]')).toBeVisible();
  expect(await map.evaluate(node => node === (window as any).contextMapNode)).toBe(true);
  hold = false;
  await expect(page.locator('.context-window-header [role=status]')).toHaveCount(0);
  expect(await map.evaluate(node => node === (window as any).contextMapNode)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("context-stable.png") });
});

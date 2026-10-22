import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('plan connection hint stays inset, secondary and readable after recovery @plans @workspace', async ({ page, request, instance }, testInfo) => {
  const title = `Connection layout ${randomUUID()}`;
  const created = await request.post(instance.endpoint + '/api/desktop/plans', {
    headers: { origin: instance.endpoint },
    data: { action: 'create', planId: randomUUID(), botId: 'default', title, tasks: [{ title: 'Read file', steps: [{ title: 'Read input' }] }] }
  });
  expect(created.ok()).toBe(true);
  await openChat(page);
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  const rail = page.getByRole('complementary', { name: /^(Plans|计划)$/ });
  const status = rail.getByRole('status').filter({ hasText: /Live updates connected|Disconnected|实时更新已连接|连接中断/ });
  await expect(status).toContainText('Live updates connected');
  await expect(rail.getByRole('button', { name: new RegExp(title) })).toBeVisible();

  async function checkLayout() {
    await expect(rail.getByRole('button', { name: new RegExp(title) })).toBeVisible();
    const geometry = await status.evaluate(element => {
      const rail = element.parentElement!;
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      const style = getComputedStyle(element);
      const sub = rail.querySelector('.plans-row-sub')!;
      return { inset: text.left - box.left, right: text.right - box.right, margin: style.marginTop, font: parseFloat(style.fontSize), color: style.color, secondary: getComputedStyle(sub).color, overflow: rail.scrollWidth - rail.clientWidth };
    });
    expect(geometry.inset).toBeGreaterThanOrEqual(16);
    expect(geometry.right).toBeLessThanOrEqual(-16);
    expect(geometry.margin).toBe('0px');
    expect(geometry.font).toBeLessThanOrEqual(13);
    expect(geometry.color).toBe(geometry.secondary);
    expect(geometry.overflow).toBe(0);
  }
  for (const [locale, appearance] of [['en-US', 'light'], ['zh-CN', 'dark']]) {
    await page.evaluate(({ locale, appearance }) => {
      document.documentElement.dataset.resolvedAppearance = appearance;
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, appearance });
    for (const width of [1440, 860, 600]) {
      await page.setViewportSize({ width, height: 940 });
      await checkLayout();
    }
  }
  await page.screenshot({ path: testInfo.outputPath('plan-status-narrow-dark.png') });
  const streamUrl = '**/api/desktop/plans?stream=true';
  await page.route(streamUrl, route => route.fulfill({ status: 503, body: 'Stream unavailable' }));
  await page.getByRole('navigation', { name: '新对话', exact: true }).getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('navigation', { name: '对话', exact: true }).getByRole('button', { name: '计划', exact: true }).click();
  await expect(status).toContainText('连接中断');
  await checkLayout();
  await page.unroute(streamUrl);
  await instance.restartService();
  await expect(status).toContainText('实时更新已连接');
  await checkLayout();
  const stored = await request.get(instance.endpoint + '/api/desktop/plans?includeArchived=true');
  expect((await stored.json()).items.some((item: { title: string }) => item.title === title)).toBe(true);
});

import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('the plan stream only surfaces a quiet status while disconnected @plans @workspace', async ({ page, request, instance }, testInfo) => {
  const title = `Connection layout ${randomUUID()}`;
  const created = await request.post(instance.endpoint + '/api/desktop/plans', {
    headers: { origin: instance.endpoint },
    data: { action: 'create', planId: randomUUID(), botId: 'default', title, tasks: [{ title: 'Read file', steps: [{ title: 'Read input' }] }] }
  });
  expect(created.ok()).toBe(true);
  await openChat(page);
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.locator('.kanban-card', { hasText: title })).toBeVisible();
  // A healthy stream says nothing: status text only appears when it is needed.
  await expect(page.locator('.plans-connection')).toHaveCount(0);

  const streamUrl = '**/api/desktop/plans?stream=true';
  await page.route(streamUrl, route => route.fulfill({ status: 503, body: 'Stream unavailable' }));
  await page.getByRole('navigation', { name: 'New chat', exact: true }).getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  const status = page.locator('.plans-connection');
  await expect(status).toContainText('Disconnected');

  async function checkLayout() {
    await expect(page.locator('.kanban-card', { hasText: title })).toBeVisible();
    const geometry = await status.evaluate(element => {
      const shell = element.closest('.plans-shell') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = shell.getBoundingClientRect();
      const style = getComputedStyle(element);
      const cardGoal = shell.querySelector('.kanban-card-goal') as HTMLElement;
      return {
        inset: text.left - box.left,
        right: text.right - box.right,
        margin: style.marginTop,
        font: parseFloat(style.fontSize),
        color: style.color,
        secondary: getComputedStyle(cardGoal).color,
        overflow: shell.scrollWidth - shell.clientWidth
      };
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
  await page.unroute(streamUrl);
  await expect(status).toHaveCount(0);
  await expect(page.locator('.kanban-card', { hasText: title })).toBeVisible();
  const stored = await request.get(instance.endpoint + '/api/desktop/plans?includeArchived=true');
  expect((await stored.json()).items.some((item: { title: string }) => item.title === title)).toBe(true);
});

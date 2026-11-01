import { test, expect } from './support/fixtures';
import { openChat, composer } from './support/actions';

test('home cards keep signals, recent navigation and quick starts usable @home-cards', async ({ page, instance }, info) => {
  for (const path of ['handover', 'handover/ack']) info.annotations.push({ type: 'expected-page-error', description: `/molibot-api/api/desktop/${path} due to access control checks` });
  await instance.stopService();
  try { await instance.runSeedScript('tests/ui/support/seed-handover.ts', { UI_HANDOVER_SCENARIO: 'cross-channel' }); }
  finally { await instance.startService(); }
  await page.route('**/api/desktop/conversations?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (new URL(route.request().url()).searchParams.get('agentId') === 'default') {
      const titles = ['Plan the next desktop release', 'Review the reading notes', 'Improve the weekly workflow'];
      data.items = data.items.map((item: any, i: number) => ({ ...item, title: titles[i % 3], latestMessagePreview: ['Scope, priorities and next steps', 'Sources and key observations', 'A simpler routine for the coming week'][i % 3] }));
    }
    await route.fulfill({ response, json: data });
  });
  await openChat(page);
  const home = page.locator('.agent-home');
  const signal = page.getByTestId('handover-cross-channel');
  await expect(signal).toContainText('Replied to 3 messages');
  await expect(home.locator('.agent-history-row')).toHaveCount(2);
  const signalBox = await signal.boundingBox();
  const homeBox = await home.boundingBox();
  expect(signalBox!.width).toBeLessThan(homeBox!.width * 0.6);
  const cards = home.locator('.agent-history-row');
  await expect.poll(async () => {
    const a = await cards.nth(0).boundingBox(); const b = await cards.nth(1).boundingBox();
    return Boolean(a && b && b.x > a.x && Math.abs(a.y - b.y) < 2);
  }).toBe(true);
  await expect(composer(page)).toBeInViewport();
  await page.screenshot({ path: info.outputPath('home-cards-light.png') });
  await cards.first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete conversation', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await cards.first().focus();
  await page.keyboard.press('Enter');
  await expect(home).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Open Momo home', exact: true }).click();
  await expect(signal).toBeVisible();
  await signal.getByRole('button', { name: 'View all', exact: true }).click();
  await expect(page.locator('.agent-history-page')).toBeVisible();
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  const prompts = page.locator('.agent-home-tasks button');
  await expect(prompts).toHaveCount(3);
  await prompts.first().click();
  await expect(composer(page)).not.toHaveValue('');
  await page.evaluate(() => {
    for (const [key, newValue] of [['molibot-desktop-locale', 'zh-CN'], ['molibot-desktop-appearance', 'dark']]) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    }
  });
  await page.getByRole('button', { name: '折叠侧边栏', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => home.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(composer(page)).toBeEnabled();
  await page.screenshot({ path: info.outputPath('home-quick-start-dark-narrow.png') });
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(signal).toBeVisible();
  await page.screenshot({ path: info.outputPath('home-cards-dark-zh.png') });
  await instance.restartService();
  await page.reload();
  await expect(signal).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  await page.unrouteAll({ behavior: 'wait' });
});

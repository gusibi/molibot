import { expect, test } from './support/fixtures';
import { composer, openChat } from './support/actions';

/**
 * PA-U3 / PA-U7 / PA-U8: the Agent home is the product surface, so its
 * identity block, composer, quick starts and recent history must survive
 * language, theme, narrow width and keyboard use, and the last Agent page must
 * survive a reload.
 */

test('Agent home shows identity, composer, quick starts and recent history @agent-home @navigation', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  await expect(page.locator('.agent-home-greeting')).not.toBeEmpty();
  const avatar = await page.locator('.agent-home-identity .agent-avatar').first().boundingBox();
  expect(Math.round(avatar?.width ?? 0)).toBe(96);
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Recent conversations' })).toBeVisible();
});

test('Agent home stays usable in Chinese, dark theme and a narrow window @agent-home @navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  await expect(page.locator('.agent-home-history').getByRole('heading', { name: '最近对话' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('the last Agent page survives reload and Agent rows are keyboard activatable @agent-home @navigation', async ({ page }) => {
  await openChat(page);
  const second = page.getByRole('button', { name: 'UI Second', exact: true });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
});

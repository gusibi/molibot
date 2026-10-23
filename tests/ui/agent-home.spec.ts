import { expect, test } from './support/fixtures';
import { composer, openChat } from './support/actions';
import type { IsolatedInstance } from './support/instance';

/**
 * PA-U3 / PA-U7 / PA-U8: the Agent home is the product surface, so its
 * identity block, composer, quick starts and recent history must survive
 * language, theme, narrow width and keyboard use, and the last Agent page must
 * survive a reload.
 *
 * PA-HD1–13: the Default Agent's home is a handover projection. The handover
 * cases below seed one scenario, restart the isolated service so a stopped
 * process owns the SQLite writes, and then assert only what the user sees.
 */

async function seedHandover(instance: IsolatedInstance, scenario: 'active' | 'quiet' | 'first-run'): Promise<void> {
  await instance.stopService();
  try {
    await instance.runSeedScript('tests/ui/support/seed-handover.ts', { UI_HANDOVER_SCENARIO: scenario });
  } finally {
    await instance.startService();
  }
}

test('Agent home shows identity, composer, quick starts and recent history @agent-home @navigation', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();

  const second = page.getByRole('button', { name: 'UI Second', exact: true });
  await second.click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  const avatar = await page.locator('.agent-home-identity .agent-avatar').first().boundingBox();
  expect(Math.round(avatar?.width ?? 0)).toBe(96);
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
  await expect(composer(page)).toBeEnabled();

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.locator('.agent-home-history').getByRole('heading', { name: '最近对话' })).toBeVisible();
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

test('first run shows what the assistant can do instead of empty data @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'first-run');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.agent-home-history')).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
});

test('the Default Agent home reports completed work and expands it into entries, while other Agents keep the start form @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toContainText('1 finished');
  await expect(page.getByTestId('handover-pending')).toContainText('Handover approval');
  await expect(page.getByTestId('handover-entries')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show 1', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.locator('.agent-home-handover')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
});

test('leaving the handover immediately still shows the same entries on return @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await page.getByRole('button', { name: 'Show 1', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
});

test('resolving a pending approval in the handover removes it without a local ghost @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-pending')).toContainText('Handover approval');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByTestId('handover-pending')).toHaveCount(0);
});

test('a quiet day keeps only the conclusion, the composer and the next scheduled line @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'quiet');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toContainText('Nothing new happened');
  await expect(page.getByTestId('handover-pending')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks')).toHaveCount(0);
  await expect(page.locator('.agent-home-history')).toHaveCount(0);
  await expect(page.getByText(/Next: Quiet briefing/)).toBeVisible();
  await expect(composer(page)).toBeEnabled();
});

test('a service interruption keeps the last handover visible and marks it stale @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await page.getByRole('button', { name: 'Show 1', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await instance.stopService();
  try {
    await expect(page.getByText('Not updated · service unreachable')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
  } finally {
    await instance.startService();
  }
});

test('the handover stays usable in Chinese, dark theme and a narrow window @agent-home @handover @navigation', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toContainText('完成了 1 件');
  await page.getByRole('button', { name: '展开 1 件', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
  await expect(page.getByTestId('handover-pending')).toContainText('等你决定');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

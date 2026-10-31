import { test, expect } from './support/fixtures';

test('plan overview filters persisted counts and keeps list readable in narrow and dark layouts @plans', async ({ page }, testInfo) => {
  await page.route('**/api/desktop/plans?*', async route => {
    const query = new URL(route.request().url());
    const archived = !query.searchParams.get('statuses') || query.searchParams.get('statuses')?.includes('completed');
    await route.fulfill({ json: { ok: true, total: archived ? 1 : 0, counts: { all: 1, not_started: 0, in_progress: 0, needs_attention: 0, finished: 0, archived: 1 }, projectIds: [], items: archived ? [{ planId: 'fixture', shortHandle: '#7', title: 'Read and verify the acceptance file with a deliberately long descriptive plan title', summary: '', status: 'completed', planStatus: 'archived', archived: true, version: 1, currentPlanVersion: 1, progress: { completed: 3, total: 3 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] : [] } });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every step, accounted for' })).toBeVisible();
  await expect(page.locator('.plans-row')).toHaveCount(1);
  await expect(page.locator('.plans-stat').last()).toContainText('1');
  await page.locator('.plans-stat').first().click();
  await expect(page.locator('.plans-row')).toHaveCount(0);
  await page.locator('.plans-stat').last().click();
  await expect(page.locator('.plans-row')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('plans-light.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('plans-dark.png') });
  await page.setViewportSize({ width: 860, height: 620 });
  await expect(page.locator('.plans-row')).toBeVisible();
  expect(await page.locator('.plans-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('plans-narrow.png') });
});

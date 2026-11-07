import { test, expect } from './support/fixtures';

test('the kanban board keeps cards readable in light, dark and narrow layouts @plans', async ({ page }, testInfo) => {
  const stamp = new Date().toISOString();
  await page.route('**/api/desktop/plans?*', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).searchParams.has('view')) return route.fallback();
    await route.fulfill({ json: { ok: true, total: 1, counts: { all: 1, todo: 0, doing: 0, done: 1, cancelled: 0 }, projectIds: [], items: [{ executionId: 'fixture', shortHandle: '#7', kind: 'legacy-plan', stage: 'done', title: 'Read and verify the acceptance file with a deliberately long descriptive plan title', goal: 'Verify the produced acceptance file line by line before accepting the result of the plan.', progress: { completed: 3, total: 3 }, version: 1, createdAt: stamp, updatedAt: stamp }] } });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every step, accounted for' })).toBeVisible();
  await expect(page.locator('.kanban-card')).toHaveCount(1);
  await expect(page.locator('.kanban-card-top strong')).toContainText('deliberately long');
  await page.screenshot({ path: testInfo.outputPath('plans-light.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('plans-dark.png') });
  await page.setViewportSize({ width: 860, height: 620 });
  await expect(page.locator('.kanban-card')).toBeVisible();
  expect(await page.locator('.plans-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('plans-narrow.png') });
});

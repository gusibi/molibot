import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

const records = Array.from({ length: 45 }, (_, i) => ({
  runId: `history-${i}`, createdAt: new Date(Date.UTC(2026, 9, 31, 9, 0) - i * 60_000).toISOString(), botId: i % 2 ? 'Research' : 'Momo', chatId: `chat-${i}`, durationMs: 1200 + i * 1400, stopReason: i % 3 === 0 ? 'error' : 'stop', toolNames: ['read', 'webSearch'], failedToolNames: i % 3 === 0 ? ['webSearch'] : [], reflectionOutcome: i % 3 === 0 ? 'failed' : i % 3 === 1 ? 'success' : 'partial', reflectionSummary: i % 3 === 0 ? 'Search provider timed out. The source review needs another attempt.' : 'Reviewed the requested material and prepared the findings for the next step.', nextAction: 'Verify the remaining source.', memorySelectedCount: 0, usedFallbackModel: false
}));

test('run history keeps its layout while loading, filters recent runs, and preserves results on refresh failure @run-history', async ({ page, instance }, info) => {
  test.info().annotations.push({ type: 'expected-page-error', description: '/molibot-api/api/desktop/handover/ack due to access control checks' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let fail = false;
  await page.route('**/api/desktop/run-history?*', async route => {
    requests++;
    await gate;
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'History temporarily unavailable' } : { ok: true, items: records } });
  });
  await openChat(page);
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  await nav.getByRole('button', { name: 'Run history', exact: true }).click();
  await expect(page.locator('.run-history-stats')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading…' })).toBeVisible();
  await nav.getByRole('button', { name: 'General', exact: true }).click();
  await nav.getByRole('button', { name: 'Run history', exact: true }).click();
  await expect(page.locator('.run-history-stats')).toBeVisible();
  expect(requests).toBe(1);
  release();
  await expect(page.locator('.run-history-entry')).toHaveCount(20);
  await expect(page.getByText('45 recent records · up to 200 loaded', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('run-history-light.png') });
  await page.getByRole('group', { name: 'Run stats' }).getByRole('button', { name: 'Failed 15', exact: true }).click();
  await expect(page.locator('.run-history-entry')).toHaveCount(15);
  const search = page.getByRole('searchbox', { name: 'Filter runs', exact: true });
  await search.fill('no match');
  await expect(page.getByText('No matching run records.', { exact: true })).toBeVisible();
  await search.fill('');
  await page.getByRole('group', { name: 'Run stats' }).getByRole('button', { name: 'All 45', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.run-history-pagination')).toContainText('Page 2 of 3');
  await page.locator('.run-history-details summary').first().click();
  await expect(page.getByText('history-20', { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load run history');
  await expect(page.locator('.run-history-entry')).toHaveCount(20);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.setViewportSize({ width: 860, height: 620 });
  expect(await page.locator('.run-history-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('run-history-dark-narrow.png') });
  await instance.restartService();
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  await page.getByRole('navigation', { name: '设置', exact: true }).getByRole('button', { name: '运行历史', exact: true }).click();
  await expect(page.locator('.run-history-entry')).toHaveCount(20);
  await page.screenshot({ path: info.outputPath('run-history-chinese.png') });

});

test('initial history failure offers retry without claiming an empty result @run-history', async ({ page }) => {
  let fail = true;
  await page.route('**/api/desktop/run-history?*', route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'History unavailable' } : { ok: true, items: [] } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Run history', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load run history');
  await expect(page.getByText('No run records yet.', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.getByText('No run records yet.', { exact: true })).toBeVisible();
});

import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';
import { desktopUsageFromRecords } from '../../src/lib/server/app/desktopUsage';
import type { AiUsageRecord } from '../../src/lib/server/usage/tracker';

const now = new Date('2026-10-31T12:00:00Z');
const records: AiUsageRecord[] = [];
for (let i = 0; i < 190; i++) {
  const date = new Date(now.getTime() - i * 86400000);
  if (i && (date.getUTCDay() === 0 || date.getUTCDay() === 6 || i % 11 === 0)) continue;
  for (let j = 0; j < 1 + i % 6; j++) records.push({ ts: date.toISOString(), requestId: `activity-${i}-${j}`, channel: j % 2 ? 'miniapp' : 'web', botId: 'personal', agentId: j % 2 ? 'research' : 'default', appId: j % 2 ? 'notes' : undefined, sessionId: j % 2 ? undefined : 'session-a', provider: 'local', model: 'fixture', api: 'chat', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: (1 + i % 8) * 120 });
}
records.push({ ...records[0], ts: '2025-01-01T12:00:00Z', requestId: 'historical', totalTokens: 20000 });

function summary(query: Record<string, string> = {}, source = records) {
  const result = desktopUsageFromRecords(source, 'Asia/Shanghai', query, now);
  for (const agent of result.options.agents) agent.label = agent.id === 'research' ? 'Research' : 'Momo';
  return result;
}

test('usage activity renders a full year, supports keyboard inspection and frequency dimensions @usage-activity', async ({ page, instance }, info) => {
  test.info().annotations.push({ type: 'expected-page-error', description: '/molibot-api/api/desktop/handover/ack due to access control checks' });
  // Floating UI's select ResizeObserver emits this WebKit notification when an
  // Agent option is committed; other page errors still fail the fixture.
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  let fail = false;
  await page.route('**/api/desktop/usage?*', route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'Usage temporarily unavailable' } : { ok: true, summary: summary(Object.fromEntries(new URL(route.request().url()).searchParams)) } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Usage', exact: true }).click();
  const activity = page.getByRole('region', { name: 'Usage activity', exact: true });
  await expect(activity.locator('[data-activity-day]')).toHaveCount(365);
  await expect(activity).toContainText('2025-01-01');
  await activity.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('usage-activity-light.png') });
  const today = activity.locator('[data-activity-day="2026-10-31"]');
  await today.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(activity.locator('[data-activity-day="2026-10-24"]')).toBeFocused();
  await expect(activity.getByRole('status')).toContainText('2026-10-24');
  await activity.getByRole('button', { name: 'tokens', exact: true }).click();
  await expect(activity.getByRole('button', { name: 'tokens', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const frequency = page.locator('.usage-activity-frequency');
  await frequency.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(frequency).toContainText('Research');
  await frequency.getByRole('button', { name: 'Channel', exact: true }).click();
  await expect(frequency).toContainText('miniapp');
  const filters = page.getByRole('group', { name: 'Filter usage', exact: true });
  await filters.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByRole('option', { name: 'Research', exact: true }).click();
  await expect(activity.locator('.usage-activity-stats dd').first()).toHaveAttribute('title', summary({ agentId: 'research' }).activity.recordedTokens.toLocaleString('en-US'));
  fail = true;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Usage temporarily unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.setViewportSize({ width: 860, height: 620 });
  await activity.scrollIntoViewIfNeeded();
  expect(await page.locator('.analytics-dashboard').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.usage-activity-calendar-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('usage-activity-dark-narrow.png') });
  await instance.restartService();
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  await page.getByRole('navigation', { name: '设置', exact: true }).getByRole('button', { name: '用量', exact: true }).click();
  const chinese = page.getByRole('region', { name: '使用活跃度', exact: true });
  await chinese.scrollIntoViewIfNeeded();
  await expect(chinese.locator('[data-activity-day]')).toHaveCount(365);
  await page.screenshot({ path: info.outputPath('usage-activity-chinese.png') });
});

test('an empty ledger has an empty calendar and cannot invent streaks @usage-activity', async ({ page }) => {
  await page.route('**/api/desktop/usage?*', route => route.fulfill({ json: { ok: true, summary: summary({}, []) } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Usage', exact: true }).click();
  const activity = page.getByRole('region', { name: 'Usage activity', exact: true });
  await expect(activity.locator('[data-activity-day][data-level="0"]')).toHaveCount(365);
  await expect(activity).toContainText('No retained request records yet.');
  await expect(activity.locator('.usage-activity-stats dd')).toHaveText(['0', '0', '0', '0', '0']);
});

test('missing activity data is reported explicitly without replacing it with zero statistics @usage-activity', async ({ page }) => {
  const { activity: _activity, ...withoutActivity } = summary();
  await page.route('**/api/desktop/usage?*', route => route.fulfill({ json: { ok: true, summary: withoutActivity } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page.getByText('Activity statistics are unavailable. Update and restart the local service.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-activity-day]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Usage overview', exact: true })).toBeVisible();
});

import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

const makeItem = (i: number, state = 'active') => ({ conversationId: `managed-${i}`, title: ['Plan the next product release', 'Review the implementation and verification notes', 'Research notes for the workspace'][i % 3], source: i % 2 ? 'external' : 'local', channel: i % 2 ? 'telegram' : 'web', botId: i % 2 ? 'Research' : 'Momo', createdAt: '2026-10-30T08:00:00Z', updatedAt: '2026-10-31T08:00:00Z', lastActivityAt: '2026-10-31T08:00:00Z', userTurnCount: i + 2, assistantTurnCount: i + 1, state, version: 1, retain: false, archivedAt: null, trashedAt: null, extractionStatus: i % 3 ? 'unprocessed' : 'saved', extractionRevision: null, processedThroughId: null, savedMemoryIds: [], savedDocRefs: [], pendingCandidateIds: [] });

test('session management prioritizes browsing and keeps filters, selection and policy accessible @session-management-polish', async ({ page, instance }, info) => {
  test.info().annotations.push({ type: 'expected-page-error', description: '/molibot-api/api/desktop/handover/ack due to access control checks' });
  let policyLoads = 0;
  const queries: URL[] = [];
  await page.route('**/api/sessions/managed?*', route => {
    const url = new URL(route.request().url());
    queries.push(url);
    const state = url.searchParams.get('state') || 'active';
    const offset = Number(url.searchParams.get('offset') || 0);
    return route.fulfill({ json: { ok: true, items: Array.from({ length: Math.min(Number(url.searchParams.get('limit') || 20), 45 - offset) }, (_, i) => makeItem(i + offset, state)), total: 45, counts: { active: 45, archived: 8, trashed: 2 }, limit: 20, offset } });
  });
  await page.route('**/api/settings/session-auto-archive', route => {
    policyLoads++;
    return route.fulfill({ json: { policy: { enabled: false, inactiveDays: 30, bots: {} }, previewCount: 0, lastRun: null } });
  });
  await page.route('**/api/sessions/managed/selections', route => route.fulfill({ json: { ok: true, selectionId: 'all-fixture', count: 45 } }));
  await page.route('**/api/sessions/managed/preview?*', route => route.fulfill({ json: { ok: true, preview: { title: 'Preview fixture', messages: [], readOnly: false } } }));
  await page.route('**/api/sessions/managed/extraction/status?*', route => route.fulfill({ json: { ok: true, extraction: null } }));
  await page.route('**/api/sessions/managed/bulk/describe-delete?*', route => route.fulfill({ json: { ok: true, count: 1, retentionDays: 30 } }));
  await openChat(page);
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  await nav.getByRole('button', { name: 'Session Management', exact: true }).click();
  const rows = page.locator('[data-session-row]');
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toBeInViewport();
  expect(policyLoads).toBe(0);
  await expect(page.locator('.settings-footbar')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('sessions-light.png') });

  await rows.first().getByRole('button', { name: 'View', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Preview fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await expect(rows.first()).toHaveAttribute('aria-selected', 'false');

  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'More filters', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('From date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Keyword', exact: true });
  await search.fill('release');
  await search.press('Enter');
  await expect.poll(() => queries.at(-1)?.searchParams.get('keyword')).toBe('release');
  await rows.first().getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog').last()).toContainText('30');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(rows.nth(1).getByRole('checkbox')).toBeChecked();
  await rows.nth(1).getByRole('checkbox').uncheck();
  await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  expect(await rows.nth(1).getAttribute('aria-selected')).toBe('false');
  await page.getByRole('button', { name: 'Archived 8', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('state')).toBe('archived');
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('offset')).toBe('20');

  const policy = page.locator('.session-manager-policy > summary');
  await policy.click();
  await expect(page.getByRole('checkbox', { name: 'Enable automatic archiving', exact: true })).toBeVisible();
  expect(policyLoads).toBe(1);
  await expect(page.locator('.settings-footbar').getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await policy.click();
  await expect(page.locator('.settings-footbar')).toHaveCount(0);

  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.setViewportSize({ width: 860, height: 620 });
  await page.locator('.settings-scroll').evaluate(el => el.scrollTop = 0);
  expect(await page.locator('.session-manager-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sessions-dark-narrow.png') });
  await instance.restartService();
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  await page.getByRole('navigation', { name: '设置', exact: true }).getByRole('button', { name: '会话管理', exact: true }).click();
  await expect(rows.first()).toBeInViewport();
  await page.screenshot({ path: info.outputPath('sessions-chinese.png') });
});

test('session management distinguishes a failed request from an empty filter result @session-management-polish', async ({ page }) => {
  let fail = true;
  await page.route('**/api/sessions/managed?*', route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'Sessions temporarily unavailable' } : { ok: true, items: [], total: 0, counts: { active: 0, archived: 0, trashed: 0 }, limit: 20, offset: 0 } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Session Management', exact: true }).click();
  await expect(page.getByText('Sessions temporarily unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No matching sessions.', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.getByText('No matching sessions.', { exact: true })).toBeVisible();
});

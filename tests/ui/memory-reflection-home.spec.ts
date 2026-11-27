import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

const candidate = {
  id: 'candidate-1', status: 'pending', namespace: 'owner:owner', domain: 'owner', type: 'user_preference',
  subject: 'report_style', value: 'Prefer concise conclusions first.', confidence: 0.9, reason: 'User update',
  sources: [], createdAt: '2026-11-07T02:00:00Z', updatedAt: '2026-11-07T02:00:00Z'
};

test('memory reflection shows the review snapshot and hides empty successful results @memory-reflection-home', async ({ page }) => {
  // Reloads fire a pagehide acknowledgement; keep that request inside the page.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).includes('/api/desktop/handover/ack')
      ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
      : original(input, init);
  });
  let pending = 2;
  const notification = () => ({
    id: 'n1', type: 'memory-review', dedupeKey: 'memory-review:owner:2026-11-07',
    payload: { pendingReviewCount: pending, scannedConversations: 495, createdCandidates: 0 },
    status: 'unread', createdAt: '2026-11-07T03:01:00Z', updatedAt: '2026-11-07T03:01:00Z'
  });
  await page.route('**/api/desktop/notifications', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { ok: true, notifications: [] } });
    return route.fulfill({ json: { ok: true, notifications: pending > 0 ? [notification()] : [] } });
  });
  await page.route('**/api/desktop/handover', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.handover.memoryReview = { items: pending > 0 ? [candidate] : [], pendingReviewCount: pending, hasMore: false, unavailable: false };
    await route.fulfill({ json: payload });
  });
  await openChat(page);
  const entry = page.getByRole('button', { name: 'Open Memory Center', exact: true });
  await expect(entry).toBeVisible();
  await expect(page.getByRole('region', { name: 'Updates' })).toContainText('2 new memories to review');
  await expect(page.getByText('Daily memory reflection', { exact: true })).toHaveCount(0);
  await expect(page.getByText(candidate.value, { exact: true })).toHaveCount(0);
  async function reloadHandover() {
    const refreshed = page.waitForResponse(response => response.url().endsWith('/api/desktop/handover') && response.ok());
    await page.reload();
    await refreshed;
    await expect(page.getByRole('region', { name: 'Momo', exact: true })).toBeVisible();
  }
  pending = 0;
  await reloadHandover();
  await expect(entry).toHaveCount(0);
  await expect(page.getByText('Daily memory reflection', { exact: true })).toHaveCount(0);
  pending = 2;
  await reloadHandover();
  await expect(entry).toBeVisible();
});

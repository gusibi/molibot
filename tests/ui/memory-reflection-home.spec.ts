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
    if (pending > 0) payload.handover.memoryReview = { items: [candidate], hasMore: false, unavailable: false };
    await route.fulfill({ json: payload });
  });
  await openChat(page);
  const card = page.locator('.agent-home-work-card').filter({ hasText: 'Daily memory reflection' });
  // The review surface is inline: pending candidates are confirmable right here.
  const review = page.getByRole('region', { name: 'Worth remembering?', exact: true });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Prefer concise conclusions first.');
  await card.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(card).toHaveCount(0);
  pending = 0;
  await page.reload();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(card).toHaveCount(0);
  pending = 2;
  await page.reload();
  await expect(review).toBeVisible();
  const unavailable = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { ok: false, error: 'Simulated service interruption' } });
  await page.route('**/api/desktop/agent-activity', unavailable);
  await page.route('**/api/desktop/handover', unavailable);
  await expect(card.getByRole('button', { name: 'Mark read', exact: true })).toBeDisabled({ timeout: 15_000 });
  await page.unroute('**/api/desktop/agent-activity', unavailable);
  await page.unroute('**/api/desktop/handover', unavailable);
  await expect(card.getByRole('button', { name: 'Mark read', exact: true })).toBeEnabled({ timeout: 10_000 });

});

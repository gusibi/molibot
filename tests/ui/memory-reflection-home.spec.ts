import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('memory reflection shows the review snapshot and hides empty successful results @memory-reflection-home', async ({ page }) => {
  // Reloads fire a pagehide acknowledgement; keep that request inside the page.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).includes('/api/desktop/handover/ack')
      ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
      : original(input, init);
  });
  let pending = 2;
  const outcome = () => ({ kind: 'memory-reflection', completedTargets: 29, scannedConversations: 495, scannedMessages: 0, createdCandidates: 0, committedMemories: 0, pendingReviewCount: pending, skillDraftCount: 0 });
  await page.route('**/api/desktop/tasks', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { ok: true, session: { taskId: 'reflection', sessionId: '', messages: [], execution: { status: 'completed', result: outcome() } } } });
    return route.fulfill({ json: { ok: true, summary: { items: [{ id: 'reflection-row', taskId: 'reflection', category: 'system', systemKind: 'memory-reflection', botId: '', projectId: '', type: 'periodic', enabled: true, text: 'Daily memory reflection', active: false, updatedAt: '2026-11-03T03:01:00Z', executions: [{ id: 'reflection-execution', status: 'completed', startedAt: '2026-11-03T03:00:00Z' }] }], targets: [], counts: {} } } });
  });
  await openChat(page);
  const card = page.locator('.agent-home-work-card').filter({ hasText: 'Daily memory reflection' });
  await expect(card).toContainText('2 memories pending review at the end of this run');
  await card.getByRole('button', { name: 'Read result', exact: true }).click();
  await expect(page.getByTestId('home-task-result')).toContainText('2 memories pending review at the end of this run');
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('molibot-home-read:')) localStorage.removeItem(key);
  });
  pending = 0;
  await page.reload();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(card).toHaveCount(0);
  pending = 2;
  await page.reload();
  await expect(card).toContainText('2 memories pending review at the end of this run');
  const unavailable = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { ok: false, error: 'Simulated service interruption' } });
  await page.route('**/api/desktop/agent-activity', unavailable);
  await page.route('**/api/desktop/handover', unavailable);
  await expect(card.getByRole('button', { name: 'Read result', exact: true })).toBeDisabled({ timeout: 15_000 });
  await page.unroute('**/api/desktop/agent-activity', unavailable);
  await page.unroute('**/api/desktop/handover', unavailable);
  await expect(card.getByRole('button', { name: 'Read result', exact: true })).toBeEnabled({ timeout: 10_000 });

});

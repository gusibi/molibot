import { test, expect } from './support/fixtures';
import { openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';

test('App displays a collapsible recovery countdown and preserves the recovered answer after restart @chat @recovery', async ({ page, instance }, info) => {
  await openChat(page);
  const marker = uniqueToken();
  const final = `RECOVERED:${marker}`;
  let attempts = 0;
  const script = replyTo(instance.model, marker, () => ++attempts <= 2
    ? { type: 'error', status: 503, message: 'Service temporarily unavailable' }
    : { type: 'text', text: final });
  await sendText(page, marker);
  const process = page.locator('.streaming-message .turn-process');
  await expect(process.locator('> summary')).toContainText('Model connection interrupted');
  await process.locator('> summary').click();
  const retry = process.locator('.process-retry-pill');
  await expect(retry).toBeVisible();
  await expect(retry).not.toHaveAttribute('open');
  await retry.locator('summary').click();
  await expect(retry.locator('pre')).toContainText('Service temporarily unavailable');
  await page.screenshot({ path: info.outputPath('retry-expanded.png') });
  await expectReply(page, final);
  expect(instance.model.matched(script.name)).toHaveLength(3);
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.getByRole('button', { name: marker, exact: true }).click();
  await expectReply(page, final);
  await instance.restartService();
  await page.reload();
  await expectReply(page, final);
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 480, height: 760 });
  await page.reload();
  await expectReply(page, final);
  await page.locator('.turn-process > summary').click();
  await expect(page.locator('.process-retry-label-text')).toContainText('连接已恢复');
  await page.screenshot({ path: info.outputPath('retry-recovered-dark-narrow.png') });
});

test('App Stop during model recovery does not start another request @chat @recovery', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const script = replyTo(instance.model, marker, { type: 'error', status: 503, message: 'Service temporarily unavailable' });
  await sendText(page, marker);
  await expect(page.locator('.streaming-message .turn-process > summary')).toContainText('Model connection interrupted');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.streaming-message')).toHaveCount(0);
  const attempts = instance.model.matched(script.name).length;
  await page.waitForTimeout(3000);
  expect(instance.model.matched(script.name)).toHaveLength(attempts);
});

test('App permanent model errors stay concise with diagnostics collapsed @chat', async ({ page, instance }, info) => {
  await openChat(page);
  const marker = uniqueToken();
  const script = replyTo(instance.model, marker, { type: 'error', status: 400, message: 'model_not_found: unknown provider for model diagnostic-fixture' });
  await sendText(page, marker);
  const status = page.locator('.conversation-system-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('This model is unavailable');
  await expect(page.locator('article.assistant')).toHaveCount(0);
  const details = status.locator('details');
  await expect(details).not.toHaveAttribute('open');
  await expect(details.locator('p')).not.toBeVisible();
  await expect(page.locator('article .markdown-body').filter({ hasText: 'diagnostic-fixture' })).toHaveCount(0);
  expect(instance.model.matched(script.name)).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('model-error-collapsed.png') });
  await details.locator('summary').click();
  await expect(details.locator('p')).toContainText('diagnostic-fixture');
});

test('an unconfirmed App submission preserves the composer without automatically resending @chat @recovery', async ({ page, instance }) => {
  await openChat(page);
  const initial = uniqueToken();
  replyTo(instance.model, initial, { type: 'text', text: `READY:${initial}` });
  await sendText(page, initial);
  await expectReply(page, `READY:${initial}`);
  await page.route('**/api/stream', route => route.abort('connectionfailed'));
  const draft = `PRESERVE:${uniqueToken()}`;
  await sendText(page, draft);
  await expect(page.getByTestId('chat-composer')).toHaveValue(draft);
  await expect(page.locator('.composer-error')).toContainText('submission is unconfirmed');
});

test('a dropped observer displays a missed approval before the task finishes @chat @recovery @approval', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, marker, { type: 'text', text: `READY:${marker}` });
  await sendText(page, marker);
  await expectReply(page, `READY:${marker}`);
  let sessionId = '', submitted = 0, resolved = false;
  await page.route('**/api/stream', async route => {
    sessionId = route.request().postDataJSON().conversationId;
    submitted++;
    await route.fulfill({ contentType: 'text/event-stream', body: 'event: token\ndata: {"delta":"partial"}\n\n' });
  });
  await page.route('**/api/desktop/session-runs', route => route.fulfill({ json: {
    ok: true, runs: sessionId && !resolved ? [{ sessionId, status: 'waiting_for_approval', waitingApproval: true }] : []
  } }));
  await page.route('**/api/desktop/host-bash', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'resolve_approval') {
      expect(body.sessionId).toBe(sessionId);
      expect(body.requestId).toBe('missed-approval');
      resolved = true;
      await route.fulfill({ json: { ok: true, response: 'Rejected', approval: { status: 'rejected' } } });
      return;
    }
    await route.fulfill({ json: { ok: true, approvals: sessionId && !resolved ? [{
      requestId: 'missed-approval', request: { command: 'echo', args: ['approval-recovery'] },
      options: [{ id: 'reject', label: 'Reject' }]
    }] : [] } });
  });
  await sendText(page, `RECOVER:${uniqueToken()}`);
  const card = page.getByTestId('decision-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('approval-recovery');
  await card.getByRole('button', { name: /Deny|Reject/ }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.streaming-message')).toHaveCount(0);
  expect(resolved).toBe(true);
  expect(submitted).toBe(1);
});

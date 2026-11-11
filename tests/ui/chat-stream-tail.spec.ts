import { test, expect } from './support/fixtures';
import { openChat, sendText, expectReply, replyTo, transcript, uniqueToken } from './support/actions';

// The running turn's pinned status row lives inside the composer card, so it
// stays in view while the transcript grows and while follow-ups queue above
// the composer — pace while tokens flow, honest waiting (plus reassurance)
// when nothing arrives, and no leftover indicator once the turn commits.
test('pinned run status shows the output pace while tokens flow and disappears when the turn commits @chat', async ({ page, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  const final = `PACE:${marker} The answer finished streaming.`;
  const script = replyTo(instance.model, marker, { type: 'thinking', thinking: 'Reason one. Reason two.', text: final, key: marker, delayMs: 250 });
  await sendText(page, marker);
  const status = page.locator('.composer .run-status');
  await expect(status).toBeVisible();
  await expect(status.locator('.run-status-label')).toHaveText('Thinking');
  await expect(status.locator('.run-status-wave')).toBeVisible();
  instance.model.release(marker);
  await expect(status.locator('.run-status-caret')).toBeVisible();
  await expect(status.locator('.run-status-label')).toHaveText('Responding');
  await expect(status.locator('.run-status-rate')).toContainText('tok/s');
  await expect(status.locator('.run-status-tokens')).toContainText('tok');
  await page.screenshot({ path: testInfo.outputPath('run-status-responding.png') });
  await expectReply(page, final);
  await expect(status).toHaveCount(0);
  expect(instance.model.matched(script.name)).toHaveLength(1);
});

test('a silent gap degrades to waiting, then reassurance, instead of a frozen status row @chat', async ({ page, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  const final = `HOLD:${marker} The model came back after the long pause.`;
  const script = replyTo(instance.model, marker, { type: 'thinking', thinking: 'Pausing here for a while.', text: final, key: marker, delayMs: 8 });
  await sendText(page, marker);
  const status = page.locator('.composer .run-status');
  await expect(status).toBeVisible();
  await expect(status.locator('.run-status-label')).toHaveText('Waiting for model output…', { timeout: 20000 });
  await page.screenshot({ path: testInfo.outputPath('run-status-waiting.png') });
  await expect(status.locator('.run-status-label')).toHaveText('Still running — not stuck', { timeout: 20000 });
  instance.model.release(marker);
  await expectReply(page, final);
  expect(instance.model.matched(script.name)).toHaveLength(1);
});

test('the status row stays put when a follow-up queues above the composer @chat', async ({ page, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  const final = `QUEUE:${marker} The answer finished streaming.`;
  // Registered first and keyed on its own text so the queued turn does not
  // reuse the held turn's script (script matching is first-match, not consumed).
  const followUpText = `queued-follow-up-${marker}`;
  replyTo(instance.model, followUpText, { type: 'text', text: `OK:${marker}` });
  replyTo(instance.model, marker, { type: 'thinking', thinking: 'Holding the turn open.', text: final, key: marker, delayMs: 8 });
  await sendText(page, marker);
  const status = page.locator('.composer .run-status');
  await expect(status).toBeVisible();
  const before = await status.boundingBox();
  await sendText(page, followUpText);
  await expect(page.locator('.queued-messages')).toBeVisible();
  const after = await status.boundingBox();
  // The card is anchored to the pane's bottom edge and the queue grows above
  // it, so the row must not move. One pixel of slack covers sub-pixel layout.
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('run-status-with-queue.png') });
  instance.model.release(marker);
  await expectReply(page, final);
  await expect(transcript(page).getByText(`OK:${marker}`, { exact: true })).toBeVisible();
});

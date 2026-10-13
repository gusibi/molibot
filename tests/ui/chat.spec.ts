import { test, expect } from './support/fixtures';
import { composer, transcript, openChat, send, expectReply, uniqueToken } from './support/actions';

test('cold start sends once and supports a second turn @chat @smoke', async ({ page, harness }) => {
  await openChat(page);
  const first = await send(page);
  await expectReply(page, first);
  expect(harness.provider.requests.filter(r => r.marker === first && !r.toolResult)).toHaveLength(1);
  const second = await send(page);
  await expectReply(page, second);
  await expect(transcript(page).getByText(`UI_REPLY:${first}`, { exact: true })).toBeVisible();
});

test('empty input cannot send; Shift+Enter inserts a newline @chat', async ({ page, harness }) => {
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  const marker = uniqueToken();
  await composer(page).fill(`[[ui:reply:${marker}]]`);
  await composer(page).press('Shift+Enter');
  await composer(page).press('a');
  await expect(composer(page)).toHaveValue(`[[ui:reply:${marker}]]\na`);
  expect(harness.provider.requests.filter(r => r.marker === marker)).toHaveLength(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expectReply(page, marker);
});

test('composition Enter does not submit unfinished input @chat', async ({ page, harness }) => {
  await openChat(page);
  const marker = uniqueToken();
  await composer(page).fill(`[[ui:reply:${marker}]]`);
  await composer(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(composer(page)).toHaveValue(`[[ui:reply:${marker}]]`);
  expect(harness.provider.requests.filter(r => r.marker === marker)).toHaveLength(0);
  await composer(page).press('Enter');
  await expectReply(page, marker);
});

test('streaming text is visible before completion; Stop permits another turn @chat @smoke', async ({ page, harness }) => {
  await openChat(page);
  const marker = await send(page, 'hold');
  await expect(transcript(page).getByText(`UI_WAITING:${marker}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  const next = await send(page);
  await expectReply(page, next);
  expect(harness.provider.requests.filter(r => r.marker === marker && !r.toolResult)).toHaveLength(1);
});

test('busy follow-up can be queued and removed without execution @chat', async ({ page, harness }) => {
  await openChat(page);
  const holding = await send(page, 'hold');
  await expect(transcript(page).getByText(`UI_WAITING:${holding}`, { exact: true })).toBeVisible();
  const queued = await send(page);
  const row = page.locator('.queued-message-row').filter({ hasText: queued });
  await expect(row).toBeVisible();
  await row.locator('.queued-remove').click();
  await row.locator('.queued-remove').click();
  await expect(row).toHaveCount(0);
  harness.provider.release(holding);
  await expectReply(page, holding);
  expect(harness.provider.requests.filter(r => r.marker === queued)).toHaveLength(0);
});

test('Agent draft switching preserves independent input @navigation @chat', async ({ page }) => {
  await openChat(page);
  await composer(page).fill('Momo unsent draft');
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Second unsent draft');
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(composer(page)).toHaveValue('Momo unsent draft');
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(composer(page)).toHaveValue('Second unsent draft');
});

test('background response stays with its originating conversation @navigation @chat', async ({ page, harness }) => {
  await openChat(page);
  const marker = await send(page, 'hold');
  await expect(transcript(page).getByText(`UI_WAITING:${marker}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(transcript(page)).toHaveCount(0);
  const second = await send(page);
  await expectReply(page, second);
  harness.provider.release(marker);
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.locator('.agent-history-row').filter({ hasText: marker }).first().click();
  await expectReply(page, marker);
  await expect(transcript(page).getByText(`UI_REPLY:${second}`, { exact: true })).toHaveCount(0);
});

test('service restart preserves selected conversation and saved transcript @recovery @chat', async ({ page, harness }) => {
  await openChat(page);
  const marker = await send(page);
  await expectReply(page, marker);
  await harness.restartService();
  await page.reload();
  await expectReply(page, marker);
  const next = await send(page);
  await expectReply(page, next);
});

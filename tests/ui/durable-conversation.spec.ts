import { test, expect } from './support/fixtures';
import { openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';

test('background execution keeps the ordinary conversation response across reload and service restart @chat', async ({ page, instance }, testInfo) => {
  test.setTimeout(120_000);
  test.info().annotations.push({ type: 'expected-page-error', description: 'Fetch API cannot load' });
  const marker = uniqueToken();
  const input = `/longtask Explain the result for ${marker}`;
  const prefix = `Live first paragraph ${marker}`;
  const tail = `\n\nFinal paragraph ${marker}`;
  const answer = `${prefix}${tail}`;
  replyTo(instance.model, marker, { type: 'hold', key: marker, text: prefix, tail });
  await openChat(page);
  await sendText(page, input);
  await expect(page.locator('.turn-process[data-state="live"]')).toHaveCount(1);
  await expect(page.locator('.durable-execution-card')).toHaveCount(0);
  await expect(page.getByText(/Created durable execution|已创建长任务/)).toHaveCount(0);
  await expect(page.locator('.message-row.mine')).toHaveCount(1);
  // The fixture is still holding the model response open: this cannot pass by final-result polling.
  await expect(page.locator('.message-row.assistant').getByText(prefix, { exact: true })).toBeVisible();
  await expect(page.getByText(`Final paragraph ${marker}`, { exact: true })).toHaveCount(0);

  const badge = page.locator('.durable-header-badge');
  await expect(badge).toBeVisible();
  await badge.click();
  await expect(page.locator('.durable-inspector')).toBeVisible();
  await expect(page.locator('.durable-inspector-status')).toContainText('Running');
  await expect(page.locator('.durable-step')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('.turn-process[data-state="live"]')).toHaveCount(1);
  await expect(page.locator('.durable-execution-card')).toHaveCount(0);
  await expect(page.locator('.message-row.assistant').getByText(prefix, { exact: true })).toBeVisible();
  await expect(badge).toBeVisible();
  await badge.click();
  await expect(page.locator('.durable-inspector')).toBeVisible();
  await expect(page.locator('.durable-inspector-status')).toContainText('Running');
  await expect(page.locator('.durable-step')).toHaveCount(1);

  instance.model.release(marker);
  await expect(page.locator('.message-row.assistant')).toContainText(`Final paragraph ${marker}`);
  await expect(page.locator('.message-row.assistant')).toHaveCount(1);
  await instance.restartService();
  await page.reload();
  await expect(page.locator('.message-row.assistant')).toContainText(`Final paragraph ${marker}`);
  await expect(page.locator('.message-row.mine')).toHaveCount(1);
  await expect(page.locator('.message-row.assistant')).toHaveCount(1);
  await expect(page.locator('.durable-execution-card')).toHaveCount(0);
  await testInfo.attach('ordinary-background-response', { body: await page.screenshot(), contentType: 'image/png' });
});

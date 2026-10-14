import { test, expect } from './support/fixtures';
import { composer, transcript, openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';
import { modelRequestMatchers } from './support/model-service';

test('cold start shows the first-launch dialog and can be dismissed @chat @smoke', async ({ page }) => {
  // Undo the fixture's first-launch skip so the real dialog is exercised.
  await page.addInitScript(() => localStorage.removeItem('molibot-desktop-first-launch-seen'));
  await page.goto('/');
  const dismiss = page.getByRole('button', { name: "Don't show again", exact: true });
  await expect(dismiss).toBeVisible();
  for (let attempt = 0; attempt < 3 && (await page.locator('.onboarding-overlay').count()) > 0; attempt += 1) {
    await dismiss.click().catch(() => undefined);
  }
  await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
});

test('cold start sends once and supports a second turn @chat @smoke', async ({ page, instance }) => {
  await openChat(page);
  const first = uniqueToken();
  const firstScript = replyTo(instance.model, `first ${first}`, { type: 'text', text: `REPLY:${first}` });
  await sendText(page, `first ${first}`);
  await expectReply(page, `REPLY:${first}`);
  expect(instance.model.matched(firstScript.name)).toHaveLength(1);

  const second = uniqueToken();
  replyTo(instance.model, `second ${second}`, { type: 'text', text: `REPLY:${second}` });
  await sendText(page, `second ${second}`);
  await expectReply(page, `REPLY:${second}`);
  await expect(transcript(page).getByText(`REPLY:${first}`, { exact: true })).toBeVisible();
});

test('empty input cannot send; Shift+Enter inserts a newline @chat', async ({ page, instance }) => {
  const base = instance.model.mark();
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  const text = `draft ${uniqueToken()}`;
  await composer(page).fill(text);
  await composer(page).press('Shift+Enter');
  await composer(page).press('a');
  await expect(composer(page)).toHaveValue(`${text}\na`);
  expect(instance.model.since(base)).toHaveLength(0);
  const marker = uniqueToken();
  replyTo(instance.model, `${text}\na`, { type: 'text', text: `REPLY:${marker}` });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expectReply(page, `REPLY:${marker}`);
});

test('composition Enter does not submit unfinished input @chat', async ({ page, instance }) => {
  const base = instance.model.mark();
  await openChat(page);
  const text = `composing ${uniqueToken()}`;
  await composer(page).fill(text);
  await composer(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(composer(page)).toHaveValue(text);
  expect(instance.model.since(base)).toHaveLength(0);
  const marker = uniqueToken();
  replyTo(instance.model, text, { type: 'text', text: `REPLY:${marker}` });
  await composer(page).press('Enter');
  await expectReply(page, `REPLY:${marker}`);
});

test('assistant reply streams progressively and then settles @chat', async ({ page, instance }) => {
  await openChat(page);
  const user = `stream ${uniqueToken()}`;
  const marker = uniqueToken();
  // Repeats the marker so it survives the first delta, which the runtime does
  // not emit (see findings): an intermediate frame must still carry it.
  const full = `CHUNK-A ${marker} CHUNK-B ${marker} CHUNK-C ${marker}`;
  replyTo(instance.model, user, { type: 'text', text: full, chunks: 9, delayMs: 300 });
  await sendText(page, user);
  await expect.poll(async () => {
    const text = (await transcript(page).allInnerTexts()).join('\n');
    const stop = await page.getByRole('button', { name: 'Stop', exact: true }).count();
    return text.includes(marker) && stop === 1 && !text.includes(full);
  }, { timeout: 10_000, message: 'expected partial streamed text while the turn is still running' }).toBe(true);
  await expect(transcript(page).getByText(full, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});

test('Stop during generation permits another turn @chat @smoke', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `hold ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 250 });
  await sendText(page, `hold ${holding}`);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);

  const next = uniqueToken();
  replyTo(instance.model, `after ${next}`, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, `after ${next}`);
  await expectReply(page, `REPLY:${next}`);
});

test('busy follow-up can be queued and removed without execution @chat', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `queued-turn ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 250 });
  await sendText(page, `queued-turn ${holding}`);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

  const queuedText = `queued-followup ${uniqueToken()}`;
  await sendText(page, queuedText);
  const row = page.locator('.queued-message-row').filter({ hasText: queuedText });
  await expect(row).toBeVisible();
  await row.locator('.queued-remove').click();
  await row.locator('.queued-remove').click();
  await expect(row).toHaveCount(0);

  instance.model.release(holding);
  await expectReply(page, `REPLY:${holding}`);
  expect(instance.model.requests.filter(request => JSON.stringify(request.messages).includes(queuedText))).toHaveLength(0);
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

test('service restart preserves selected conversation and saved transcript @recovery @chat', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, `persist ${marker}`, { type: 'text', text: `REPLY:${marker}` });
  await sendText(page, `persist ${marker}`);
  await expectReply(page, `REPLY:${marker}`);

  await instance.stopService();
  await instance.startService();
  await page.reload();
  await expectReply(page, `REPLY:${marker}`);

  const next = uniqueToken();
  replyTo(instance.model, `after-restart ${next}`, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, `after-restart ${next}`);
  await expectReply(page, `REPLY:${next}`);
});

const failureScenarios = [
  { name: 'rate limit 429', reply: { type: 'error', status: 429, message: 'rate limited' } as const, needle: 'rate limited' },
  { name: 'server error 500', reply: { type: 'error', status: 500, message: 'boom' } as const, needle: 'boom' },
  { name: 'dropped connection', reply: { type: 'markerThenDrop', kind: 'disconnect', text: 'PARTIAL' } as const, needle: 'PARTIAL' }
];

for (const scenario of failureScenarios) {
  test(`request failure (${scenario.name}) surfaces an error and permits a retry @chat @failure`, async ({ page, instance }) => {
    await openChat(page);
    const failing = uniqueToken();
    const script = replyTo(instance.model, `fail ${failing}`, scenario.reply);
    await sendText(page, `fail ${failing}`);
    // The turn settles as a failed assistant entry: it carries the stop reason
    // and the "Error" state, and Stop is released.
    await expect(transcript(page).filter({ hasText: scenario.needle })).toBeVisible();
    await expect(transcript(page).filter({ hasText: 'Error' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    // A failing provider may be retried by the adapter; the guard here is that
    // the turn settled and a fresh send still works, not the retry count.
    expect(instance.model.matched(script.name).length).toBeGreaterThanOrEqual(1);

    const retry = uniqueToken();
    replyTo(instance.model, `retry ${retry}`, { type: 'text', text: `REPLY:${retry}` });
    await sendText(page, `retry ${retry}`);
    await expectReply(page, `REPLY:${retry}`);
  });
}

test('a background reply stays with its originating conversation @navigation @chat', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `background ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 250 });
  await sendText(page, `background ${holding}`);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

  // The other Agent's view must not show the running conversation's content.
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(transcript(page)).toHaveCount(0);

  instance.model.release(holding);
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  const row = page.locator('.agent-history-row').filter({ hasText: `background ${holding}` });
  if (await row.count()) await row.first().click();
  await expectReply(page, `REPLY:${holding}`);
});

const stopButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Stop', exact: true });

test('a rapid double submit does not duplicate the message @chat @input', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const text = `double ${marker}`;
  const script = replyTo(instance.model, text, { type: 'text', text: `REPLY:${marker}` });
  await composer(page).fill(text);
  // Two clicks in one task: the app must not submit the same message twice.
  await page.getByRole('button', { name: 'Send', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expectReply(page, `REPLY:${marker}`);
  expect(instance.model.matched(script.name)).toHaveLength(1);
});

test('queued follow-ups run in order after the running turn @chat @queue', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `order-hold ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 200 });
  await sendText(page, `order-hold ${holding}`);
  await expect(stopButton(page)).toBeVisible();

  const first = uniqueToken();
  const second = uniqueToken();
  const firstScript = replyTo(instance.model, `order-a ${first}`, { type: 'text', text: `REPLY:${first}` });
  const secondScript = replyTo(instance.model, `order-b ${second}`, { type: 'text', text: `REPLY:${second}` });
  await sendText(page, `order-a ${first}`);
  await sendText(page, `order-b ${second}`);
  await expect(page.locator('.queued-message-row')).toHaveCount(2);

  instance.model.release(holding);
  await expect(transcript(page).getByText(`REPLY:${first}`, { exact: true })).toBeVisible();
  await expect(transcript(page).getByText(`REPLY:${second}`, { exact: true })).toBeVisible();
  expect(instance.model.matched(firstScript.name)[0].index).toBeLessThan(instance.model.matched(secondScript.name)[0].index);
});

test('clearing the queue prevents every queued message from running @chat @queue', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `clear-hold ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 200 });
  await sendText(page, `clear-hold ${holding}`);
  await expect(stopButton(page)).toBeVisible();

  const first = uniqueToken();
  const second = uniqueToken();
  await sendText(page, `clear-a ${first}`);
  await sendText(page, `clear-b ${second}`);
  const rows = page.locator('.queued-message-row');
  await expect(rows).toHaveCount(2);
  const row = (text: string) => rows.filter({ hasText: text });
  for (const text of [`clear-a ${first}`, `clear-b ${second}`]) {
    await row(text).locator('.queued-remove').click();
    await row(text).locator('.queued-remove').click();
  }
  await expect(rows).toHaveCount(0);

  instance.model.release(holding);
  await expectReply(page, `REPLY:${holding}`);
  const executed = instance.model.requests.filter(request => JSON.stringify(request.messages).includes(first));
  expect(executed).toHaveLength(0);
  expect(instance.model.requests.filter(request => JSON.stringify(request.messages).includes(second))).toHaveLength(0);
});

test('steering injects a queued message into the running turn @chat @queue', async ({ page, instance }) => {
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `steer-hold ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 200 });
  await sendText(page, `steer-hold ${holding}`);
  await expect(stopButton(page)).toBeVisible();

  const steerText = `steer-now ${uniqueToken()}`;
  const steered = replyTo(instance.model, steerText, { type: 'text', text: `STEERED:${holding}` });
  await sendText(page, steerText);
  const steering = page.waitForResponse(response => response.url().includes('/api/stream/steer') && response.request().method() === 'POST');
  await page.locator('.queued-message-row').filter({ hasText: steerText }).locator('.queued-steer').click();
  const delivered = await (await steering).json();
  expect(delivered.delivered).toBe(true);
  await expect(page.locator('.queued-message-row').filter({ hasText: steerText })).toHaveCount(0);

  instance.model.release(holding);
  // The steering text is delivered into the running turn and reaches the model.
  await expect(transcript(page).getByText(`STEERED:${holding}`, { exact: true })).toBeVisible();
  expect(instance.model.matched(steered.name).length).toBeGreaterThanOrEqual(1);
});

test('Stop while a tool runs permits another turn @chat @stop', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, `toolstop ${marker}`, { type: 'toolCalls', calls: [{ name: 'bash', args: { label: `sleep ${marker}`, command: 'sleep 20' } }] });
  await sendText(page, `toolstop ${marker}`);
  const card = page.getByTestId('decision-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Just once|Allow once/ }).click();
  await expect(card).toHaveCount(0);
  // The approved command is now running; stopping must end the turn.
  await expect(stopButton(page)).toBeVisible();
  await stopButton(page).click();
  await expect(stopButton(page)).toHaveCount(0);

  const next = uniqueToken();
  replyTo(instance.model, `after-toolstop ${next}`, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, `after-toolstop ${next}`);
  await expectReply(page, `REPLY:${next}`);
});

test('Stop while waiting for approval permits another turn @chat @stop', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, `stopapproval ${marker}`, { type: 'toolCalls', calls: [{ name: 'write', args: { label: `probe ${marker}`, path: `ui-probe-${marker}.txt`, content: 'never' } }] });
  await sendText(page, `stopapproval ${marker}`);
  await expect(page.getByTestId('decision-card')).toBeVisible();
  await stopButton(page).click();
  await expect(stopButton(page)).toHaveCount(0);

  const next = uniqueToken();
  replyTo(instance.model, `after-stopapproval ${next}`, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, `after-stopapproval ${next}`);
  await expectReply(page, `REPLY:${next}`);

  // The stopped turn's approval may legitimately remain answerable; decline it
  // so it cannot leak into a later test.
  const card = page.getByTestId('decision-card');
  if (await card.count()) await card.getByRole('button', { name: /Deny|Reject/ }).click();
});

test('an approval and a queued follow-up both advance @chat @approval @queue', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  instance.model.script({
    name: `tool:${marker}`,
    when: request => {
      const matchers = modelRequestMatchers(request);
      return request.tools.length > 0 && !matchers.afterToolResults && matchers.lastUserText.includes(marker);
    },
    reply: { type: 'toolCalls', calls: [{ name: 'write', args: { label: `probe ${marker}`, path: `ui-probe-${marker}.txt`, content: `approved:${marker}` } }] }
  });
  const follow = instance.model.script({
    name: `follow:${marker}`,
    when: request => {
      const matchers = modelRequestMatchers(request);
      return matchers.afterToolResults && matchers.lastUserText.includes(marker);
    },
    reply: { type: 'text', text: `FIRST_DONE:${marker}` }
  });
  await sendText(page, `queueapproval ${marker}`);
  await expect(page.getByTestId('decision-card')).toBeVisible();
  const queued = uniqueToken();
  const queuedScript = replyTo(instance.model, `queued-after ${queued}`, { type: 'text', text: `SECOND_DONE:${queued}` });
  await sendText(page, `queued-after ${queued}`);
  await expect(page.locator('.queued-message-row')).toHaveCount(1);

  await page.getByTestId('decision-card').getByRole('button', { name: /Just once|Allow once/ }).click();
  await expect(transcript(page).getByText(`FIRST_DONE:${marker}`, { exact: true })).toBeVisible();
  await expect(transcript(page).getByText(`SECOND_DONE:${queued}`, { exact: true })).toBeVisible();
  expect(instance.model.matched(follow.name).length).toBeGreaterThanOrEqual(1);
  expect(instance.model.matched(queuedScript.name)[0].index).toBeGreaterThan(instance.model.matched(follow.name)[0].index);
});

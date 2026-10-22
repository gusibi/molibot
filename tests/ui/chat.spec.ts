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

test('thinking opens live, folds for the answer, and can be reopened @chat', async ({ page, instance }, testInfo) => {
  await openChat(page);
  const marker = uniqueToken();
  const thinking = `Inspect the evidence ${marker}. Check the result ${marker}.`;
  const answer = `ANSWER:${marker} ${'The evidence is ready. '.repeat(30)}`;
  const script = replyTo(instance.model, `think ${marker}`, { type: 'thinking', thinking, text: answer, key: marker, delayMs: 100 });
  await sendText(page, `think ${marker}`);
  const card = page.locator('.thinking-card').last();
  await expect(card).toHaveAttribute('open', '');
  await expect(card.locator('pre')).toHaveText(thinking);
  await page.screenshot({ path: testInfo.outputPath('thinking-live.png') });
  instance.model.release(marker);
  await expect(page.locator('.streaming-message')).toContainText(`ANSWER:${marker}`);
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('pre')).toHaveText(thinking);
  await expectReply(page, answer.trim());
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('pre')).toHaveText(thinking);
  expect(instance.model.matched(script.name)).toHaveLength(1);
  await page.goto('about:blank');
  await instance.restartService();
  await page.goto(instance.frontend);
  await expectReply(page, answer.trim());
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('pre')).toHaveText(thinking);
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 600, height: 760 });
  await page.reload();
  await expect(card.locator('summary')).toHaveText('思考过程');
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('pre')).toHaveText(thinking);
  await page.screenshot({ path: testInfo.outputPath('thinking-history-dark-narrow.png') });
});

test('stopping during thinking retains a collapsed, readable history @chat', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const thinking = `Check cancellation ${marker}. Preserve partial reasoning ${marker}.`;
  replyTo(instance.model, marker, { type: 'thinking', thinking, text: 'Unsent answer', key: marker });
  await sendText(page, marker);
  await expect(page.locator('.thinking-card pre')).toHaveText(thinking);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  const card = page.locator('.thinking-card').last();
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('pre')).toHaveText(thinking);
  await expect(page.getByText('Unsent answer', { exact: true })).toHaveCount(0);
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
  await expect(page.locator('.thinking-card')).toHaveCount(0);
});

test('editable Web sessions omit refresh and settled turns stay silent @chat', async ({ page, instance }) => {
  await openChat(page);
  const refresh = page.getByRole('button', { name: 'Refresh conversations', exact: true });
  // Agent home never shows the refresh control; the conversation lists don't either.
  await expect(refresh).toHaveCount(0);
  const settled = uniqueToken();
  replyTo(instance.model, `quiet ${settled}`, { type: 'text', text: `REPLY:${settled}` });
  await sendText(page, `quiet ${settled}`);
  await expectReply(page, `REPLY:${settled}`);
  await expect(refresh).toHaveCount(0);
  await expect(page.locator(".chat-agent-label")).toHaveText("Momo");
  await expect(page.getByRole("button", { name: "Agent conversations", exact: true })).toBeVisible();
  await expect(page.locator('.conversation-system-status')).toHaveCount(0);

  const failing = uniqueToken();
  replyTo(instance.model, `fail ${failing}`, { type: 'error', status: 500, message: `boom ${failing}` });
  await sendText(page, `fail ${failing}`);
  await expect(transcript(page).filter({ hasText: `boom ${failing}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  // Failed turns surface the one status divider; success never does.
  await expect(page.locator('.conversation-system-status')).toHaveCount(1);
  await expect(page.locator('.conversation-system-status')).toContainText('Run failed');
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

/** Capture each turn's stream POST body: it carries the conversation and profile the UI chose. */
function captureStreamTurns(page: import('@playwright/test').Page): Array<{ conversationId: string; profileId: string; message: string }> {
  const turns: Array<{ conversationId: string; profileId: string; message: string }> = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/api/stream')) return;
    try {
      turns.push(JSON.parse(request.postData() ?? '{}'));
    } catch {
      // A non-JSON body is not a chat turn.
    }
  });
  return turns;
}

/** Read a conversation back from the server's storage, not from the rendered DOM. */
async function readStoredSession(instance: { endpoint: string }, conversationId: string, profileId: string): Promise<string> {
  const url = `${instance.endpoint}/api/sessions/${encodeURIComponent(conversationId)}?profileId=${encodeURIComponent(profileId)}`;
  const response = await fetch(url);
  expect(response.ok, `session read-back failed: HTTP ${response.status}`).toBe(true);
  return JSON.stringify(await response.json());
}

test('each conversation persists its own messages (storage read-back) @navigation @chat', async ({ page, instance }) => {
  const turns = captureStreamTurns(page);
  await openChat(page);
  const momo = uniqueToken();
  replyTo(instance.model, `persist-momo ${momo}`, { type: 'text', text: `MOMO_REPLY:${momo}` });
  await sendText(page, `persist-momo ${momo}`);
  await expectReply(page, `MOMO_REPLY:${momo}`);

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  const second = uniqueToken();
  replyTo(instance.model, `persist-second ${second}`, { type: 'text', text: `SECOND_REPLY:${second}` });
  await sendText(page, `persist-second ${second}`);
  await expectReply(page, `SECOND_REPLY:${second}`);

  const momoTurn = turns.find((turn) => turn.message === `persist-momo ${momo}`);
  const secondTurn = turns.find((turn) => turn.message === `persist-second ${second}`);
  expect(momoTurn).toBeTruthy();
  expect(secondTurn).toBeTruthy();
  expect(momoTurn!.conversationId).not.toBe(secondTurn!.conversationId);

  // Business state: each turn landed in its own conversation on disk.
  const momoStored = await readStoredSession(instance, momoTurn!.conversationId, momoTurn!.profileId);
  const secondStored = await readStoredSession(instance, secondTurn!.conversationId, secondTurn!.profileId);
  expect(momoStored).toContain(`MOMO_REPLY:${momo}`);
  expect(momoStored).not.toContain(`SECOND_REPLY:${second}`);
  expect(secondStored).toContain(`SECOND_REPLY:${second}`);
  expect(secondStored).not.toContain(`MOMO_REPLY:${momo}`);
});

test('a reply that finishes in the background persists to its originating conversation @navigation @chat', async ({ page, instance }) => {
  const turns = captureStreamTurns(page);
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `bg-persist ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nBG_REPLY:${holding}`, delayMs: 100 });
  await sendText(page, `bg-persist ${holding}`);
  await expect(stopButton(page)).toBeVisible();

  // Leave the running conversation for another Agent before the reply is ready;
  // the in-flight content must not appear under the other Agent.
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(transcript(page)).toHaveCount(0);

  instance.model.release(holding);
  const bgTurn = turns.find((turn) => turn.message === `bg-persist ${holding}`);
  expect(bgTurn).toBeTruthy();
  await expect.poll(async () => {
    const stored = await readStoredSession(instance, bgTurn!.conversationId, bgTurn!.profileId);
    return stored.includes(`BG_REPLY:${holding}`);
  }, { message: 'the background reply must land in its own conversation storage' }).toBe(true);

  // Back on the originating Agent the reply is attached to its conversation.
  await page.getByRole('button', { name: /^Momo/ }).click();
  const row = page.locator('.agent-history-row').filter({ hasText: `bg-persist ${holding}` });
  if (await row.count()) await row.first().click();
  await expectReply(page, `BG_REPLY:${holding}`);
});

test('refreshing mid-generation resumes the run without losing or duplicating the reply @recovery @chat', async ({ page, instance }) => {
  // Reloading mid-stream deliberately cancels the in-flight fetches; WebKit
  // reports the cancellations as page errors. They are the price of the
  // navigation under test, not a product failure.
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  test.info().annotations.push({ type: 'expected-page-error', description: 'Unhandled Promise Rejection: TypeError: Load failed' });
  await openChat(page);
  const holding = uniqueToken();
  const script = replyTo(instance.model, `refresh ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 100 });
  await sendText(page, `refresh ${holding}`);
  await expect(stopButton(page)).toBeVisible();

  // Refresh while the turn is generating. The server keeps the run (it is no
  // longer tied to this request); the Desktop reattaches instead of aborting.
  await page.reload();
  await expect(stopButton(page)).toBeVisible({ timeout: 20_000 });

  instance.model.release(holding);
  // The reply lands exactly once, with no message re-sent to the model.
  await expectReply(page, `REPLY:${holding}`);
  await expect(transcript(page).getByText(`REPLY:${holding}`, { exact: true })).toHaveCount(1);
  expect(instance.model.matched(script.name)).toHaveLength(1);
});

test('a stalled stream surfaces the idle timeout and permits another turn @chat @failure', async ({ page, instance }) => {
  test.setTimeout(120_000);
  // Fake page timers so the fixed 90s transport watchdog can be reached without
  // waiting it out; the network is real and the message is never answered.
  await page.clock.install();
  await openChat(page);
  const holding = uniqueToken();
  replyTo(instance.model, `timeout ${holding}`, { type: 'hold', text: `WAITING:${holding}`, key: holding, tail: `\n\nREPLY:${holding}`, delayMs: 50 });

  const streamStarted = page.waitForResponse(response => response.url().endsWith('/api/stream') && response.request().method() === 'POST');
  await sendText(page, `timeout ${holding}`);
  await streamStarted;
  await expect(stopButton(page)).toBeVisible();

  // No frame arrives past the watchdog window: the turn must not hang forever.
  await page.clock.fastForward(95_000);

  const banner = page.locator('.composer-error');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/idle/i);
  await expect(stopButton(page)).toHaveCount(0);

  // The task may still be finishing server-side; let it settle, then the user
  // can send again rather than facing a permanently blocked composer.
  instance.model.release(holding);
  await expect.poll(async () => {
    const response = await fetch(`${instance.endpoint}/api/desktop/session-runs`);
    const body = (await response.json()) as { runs?: unknown[] };
    return body.runs?.length ?? 0;
  }, { message: 'the held run must settle before the next turn' }).toBe(0);

  const next = uniqueToken();
  replyTo(instance.model, `after-timeout ${next}`, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, `after-timeout ${next}`);
  await expectReply(page, `REPLY:${next}`);
});

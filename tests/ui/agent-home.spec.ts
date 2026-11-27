import { expect, test } from './support/fixtures';
import { composer, openChat } from './support/actions';
import type { IsolatedInstance } from './support/instance';

/**
 * PA-U3 / PA-U7 / PA-U8: the Agent home is the product surface, so its
 * identity block, composer, quick starts and recent history must survive
 * language, theme, narrow width and keyboard use, and the last Agent page must
 * survive a reload.
 *
 * PA-HD1–13: the Default Agent's home is a handover projection. The handover
 * cases below seed one scenario, restart the isolated service so a stopped
 * process owns the SQLite writes, and then assert only what the user sees.
 */

async function seedHandover(instance: IsolatedInstance, scenario: 'active' | 'busy' | 'history' | 'quiet' | 'first-run' | 'cross-channel' | 'external-source' | 'editorial' | 'typed' | 'memory' | 'memory-comparison'): Promise<void> {
  await instance.stopService();
  try {
    await instance.runSeedScript('tests/ui/support/seed-handover.ts', { UI_HANDOVER_SCENARIO: scenario });
  } finally {
    await instance.startService();
  }
}

test('Agent home shows identity, composer, quick starts and recent history @agent-home @navigation', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();

  const second = page.getByRole('button', { name: 'UI Second', exact: true });
  await second.click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  // The Agent's face on the desk is Momo's expression for its real state, not a fixed avatar.
  const stage = page.locator('.agent-home-stage .momo-stage');
  await expect(stage).toBeVisible();
  expect(await page.locator('.agent-home').evaluate(node => getComputedStyle(node).position)).toBe('static');
  const stageButton = stage.getByRole('button');
  const originalStageButton = await stageButton.elementHandle();
  await composer(page).focus();
  await expect(stage).toHaveAttribute('data-expression', 'thinking');
  expect(await stageButton.evaluate((node, original) => node === original, originalStageButton)).toBe(true);
  expect(Math.round((await stage.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(340);
  await expect(stage).toHaveAttribute('data-expression', /^[a-z-]+$/);
  // A later legacy rule with the same class name once turned the desk back into one column.
  expect(await page.locator('.agent-home-layout').evaluate((node) => getComputedStyle(node).display)).toBe('grid');
  expect(await page.locator('.agent-home-stage').evaluate((node) => node.compareDocumentPosition(document.querySelector('.agent-home-desk')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Recent conversations' })).toBeVisible();
});

test('Agent home stays usable in Chinese, dark theme and a narrow window @agent-home @navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();

  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.locator('.agent-home-history').getByRole('heading', { name: '最近对话' })).toBeVisible();
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('the last Agent page survives reload and Agent rows are keyboard activatable @agent-home @navigation', async ({ page }) => {
  await openChat(page);
  const second = page.getByRole('button', { name: 'UI Second', exact: true });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
});

test('first run shows what the assistant can do instead of empty data @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'first-run');
  await openChat(page);
  await expect(page.getByRole('region', { name: 'Updates' })).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.agent-home-history')).toContainText('No conversations yet');
  await expect(composer(page)).toBeEnabled();
});

test('the Default Agent home shows completed work while other Agents keep the start form @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByRole('heading', { name: 'Ready for you' })).toBeVisible();
  await expect(page.getByTestId('handover-pending-card')).toContainText('Handover approval');
  await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Updates' })).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.agent-home-say')).not.toContainText('your decision', { timeout: 1500 });
  await expect(page.locator('.momo-stage')).not.toHaveAttribute('data-expression', 'proactive-alert');
});

test('incoming updates keep the composer focused while the desk becomes compact @agent-home', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/desktop\/handover(?:\?.*)?$/, async route => {
    await gate;
    await route.continue();
  });
  try {
    await openChat(page);
    const input = composer(page);
    await input.fill('Draft while updates load');
    await expect(input).toBeFocused();
    release();
    await expect(page.getByTestId('handover-pending-card')).toBeVisible();
    expect(Math.round((await page.locator('.momo-stage--pin').boundingBox())?.width ?? 0)).toBe(72);
    await expect(input).toBeFocused({ timeout: 1500 });
    await expect(input).toHaveValue('Draft while updates load');
  } finally {
    release();
  }
});

test('replies already read on another channel collapse into one card @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'cross-channel');
  await openChat(page);
  const card = page.getByTestId('handover-cross-channel');
  await expect(card).toContainText('Replied to 3 messages');
  // Channels are expressed by their logos, not by a text label.
  await expect(card.locator('img')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Updates' }).getByRole('article')).toHaveCount(1);
  await expect(composer(page)).toBeEnabled();
});

test('leaving the handover immediately still shows the same entries on return @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');
});

test('opening Agent overview acknowledges leaving the home without switching drafts @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-pending-card')).toBeVisible();

  const acknowledged = page.waitForResponse(response =>
    response.url().endsWith('/api/desktop/handover/ack') && response.request().method() === 'POST'
  );
  await page.locator('.agent-home').getByRole('button', { name: /View activity/ }).click();
  expect((await acknowledged).ok()).toBe(true);
  await expect(page.locator('.agent-home')).toHaveCount(0);
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.agent-home-say')).not.toContainText('You were away');
});

test('resolving a pending approval in the handover removes it without a local ghost @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-pending-card')).toContainText('Handover approval');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByTestId('handover-pending-card')).toHaveCount(0);
});

test('a quiet day uses the same start form as every other Agent @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'quiet');
  await openChat(page);
  await expect(page.getByRole('region', { name: 'Updates' })).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Recent conversations' })).toBeVisible();
  await expect(page.getByText(/Next: Quiet briefing/)).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
});

test('a service interruption keeps the last handover visible and marks it stale @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');

  await instance.stopService();
  try {
    await expect(page.getByText('Offline · showing last synced updates')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  } finally {
    await instance.startService();
  }
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.getByText('Offline · showing last synced updates')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
});

test('the handover stays usable in Chinese, dark theme and a narrow window @agent-home @handover @navigation', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await expect(page.getByRole('heading', { name: '刚为你准备好' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Updates|待处理与新成果/ })).toContainText('Handover UI task');
  await expect(page.getByTestId('handover-pending-card')).toContainText('Handover approval');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a busy day lists outcomes, readable failures and pending approvals @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'busy');
  await openChat(page);
  const updates = page.getByRole('region', { name: 'Updates' });
  for (let number = 1; number <= 6; number++) {
    await expect(updates.getByRole('button', { name: `Busy task ${number}`, exact: true })).toBeVisible();
  }
  await expect(updates.getByText('Model sign-in failed: the API key is invalid or expired', { exact: true })).toBeVisible();
  await expect(updates).not.toContainText('provider=cli-proxy-api');
  const pending = page.getByTestId('handover-pending-card');
  await expect(pending).toHaveCount(6);
  await expect(pending.filter({ hasText: 'Busy approval 1' })).toContainText('agent-browser --open 1');
  await expect(pending.filter({ hasText: 'Busy approval 6' })).toBeVisible();
});

test('opening the app lands on the handover while a reload keeps the current place @agent-home @handover @navigation', async ({ page, context, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);

  // A saved page must survive reloads (PA-U3).
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();

  // A new app window is "open the app", so it leads with the handover again.
  const fresh = await context.newPage();
  try {
    await fresh.goto('/');
    await expect(fresh.getByRole('heading', { name: 'Ready for you' })).toBeVisible();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('finished work spans days without repeating the list layout @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'history');
  await openChat(page);

  const entries = page.getByRole('region', { name: /Updates|待处理与新成果/ });
  await expect(entries).toContainText('Grouped task today');
  await expect(entries).toContainText('Grouped task yesterday');
  await expect(entries.getByRole('button', { name: 'Quick preview', exact: true })).toHaveCount(2);
});

test('keyboard users can open and close an exact result preview @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  const preview = page.getByRole('button', { name: 'Quick preview', exact: true });
  await preview.focus();
  await expect(preview).toBeFocused();
  await page.keyboard.press('Enter');
  const details = page.getByTestId('home-task-result');
  await expect(details).toContainText('Handover UI task delivered');
  const toggle = page.getByRole('button', { name: 'Hide preview', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.press('Enter');
  await expect(details).toHaveCount(0);
});

test('an external source opens by Session id even when the trace channel was web @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'external-source');
  await page.route('**/api/desktop/external-sessions/external-source-1', (route) => route.fulfill({
    json: {
      ok: true,
      transcript: {
        id: 'external-source-1',
        channel: 'feishu',
        title: 'External source title',
        updatedAt: new Date().toISOString(),
        chatType: 'private',
        senderName: 'Owner',
        messages: [{ id: 'm1', role: 'assistant', content: 'Delivered result', createdAt: new Date().toISOString() }]
      }
    }
  }));

  await openChat(page);
  await page.getByRole('region', { name: /Updates|待处理与新成果/ }).getByRole('button', { name: 'External source task', exact: true }).click();
  await expect(page.locator('.chat-header')).toContainText('External source title');
  await expect.poll(async () => {
    const response = await page.request.get(`${instance.endpoint}/api/desktop/notifications?status=read`);
    const { notifications } = await response.json();
    return notifications.some((item: { payload: { sessionId?: string } }) => item.payload.sessionId === 'external-source-1');
  }).toBe(true);
  await expect(page.getByText('Could not open the source conversation.')).toHaveCount(0);
});

test('a waiting row opens its own session instead of the history list @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);

  await page.getByTestId('handover-pending-card').getByText('Handover approval', { exact: true }).click();
  await expect(page.locator('.agent-home')).toHaveCount(0);
  await expect(page.locator('.chat-header')).toContainText('Handover seed');
  await expect(composer(page)).toBeVisible();
});


test('work home keeps visible commands and outcomes below the composer @agent-home @home-dashboard', async ({ page, instance }, testInfo) => {
  await seedHandover(instance, 'active');
  await page.setViewportSize({ width: 1440, height: 1024 });
  await openChat(page);
  const results = page.getByRole('region', { name: 'Updates', exact: true });
  await expect(results).toContainText('Handover UI task');
  const decisions = page.getByTestId('handover-pending-card');
  await expect(decisions).toContainText('Handover approval');
  const input = await composer(page).boundingBox();
  const feed = await results.boundingBox();
  expect(input!.y + input!.height).toBeLessThan(feed!.y);
  await expect(decisions.getByText('agent-browser --open', { exact: true })).toBeVisible();
  await testInfo.attach('work-home-wide', { body: await page.screenshot(), contentType: 'image/png' });
  await page.route('**/api/desktop/host-bash', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, json: { ok: false, error: 'UI simulated rejection failure' } });
    else await route.continue();
  });
  await decisions.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('UI simulated rejection failure');
  await expect(decisions).toContainText('Handover approval');
  expect((await (await page.request.get(`${instance.endpoint}/api/desktop/handover`)).json()).handover.pending).toHaveLength(1);
  await page.unroute('**/api/desktop/host-bash');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer(page)).toBeEnabled();
  await expect.poll(async () => (await page.locator('.agent-home').boundingBox())?.width ?? 0).toBeGreaterThan(300);
  await expect(page.getByRole('button', { name: 'Momo', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Momo', exact: true })).toBeVisible();
  const sidebarBounds = await page.locator('.chat-sidebar').boundingBox();
  const headerBounds = await page.locator('.window-header').boundingBox();
  expect(Math.abs(sidebarBounds!.y - (headerBounds!.y + headerBounds!.height))).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Momo', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach('work-home-narrow', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => {
    for (const [key, newValue] of [['molibot-desktop-locale', 'zh-CN'], ['molibot-desktop-appearance', 'dark'], ['molibot-desktop-theme-family', 'brutalism']]) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
    }
  });
  await expect(page.getByRole('region', { name: '待处理与新成果', exact: true })).toContainText('Handover UI task');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach('work-home-zh-dark-square', { body: await page.screenshot(), contentType: 'image/png' });
  await decisions.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(decisions).toHaveCount(0);
  await expect.poll(async () => {
    const response = await page.request.get(`${instance.endpoint}/api/desktop/handover`);
    return (await response.json()).handover.pending.length;
  }).toBe(0);
  await expect(page.getByRole('region', { name: '待处理与新成果', exact: true })).toContainText('Handover UI task');
});


test('the work home reads as one composed workspace across sizes and themes @agent-home @home-craft', async ({ page, instance }, testInfo) => {
  await seedHandover(instance, 'editorial');
  await page.setViewportSize({ width: 1440, height: 1024 });
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Weekly research brief', exact: true })).toBeVisible();
  await expect(page.getByTestId('handover-pending-card').filter({ hasText: 'Read the source documents' })).toBeVisible();
  await expect(page.getByTestId('handover-pending-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Ready for you', exact: true })).toHaveCount(1);
  const input = await composer(page).boundingBox();
  const workspace = await page.locator('.agent-home').boundingBox();
  expect(input!.width).toBeGreaterThan(600);
  expect(input!.width).toBeLessThanOrEqual(workspace!.width + 1);
  expect(Math.abs(input!.x + input!.width / 2 - workspace!.x - workspace!.width / 2)).toBeLessThan(2);
  expect(input!.y).toBeLessThan(512);
  await testInfo.attach('craft-light-wide', { body: await page.screenshot(), contentType: 'image/png' });

  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-appearance', newValue: 'dark' })));
  await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
  await testInfo.attach('craft-dark-wide', { body: await page.screenshot(), contentType: 'image/png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.window-header .chat-title-block')).toBeHidden();
  const headerButtonsFit = await page.locator('.window-header').getByRole('button').evaluateAll(nodes => nodes.every(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth + 1;
  }));
  expect(headerButtonsFit).toBe(true);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await composer(page).focus();
  await expect(composer(page)).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeFocused();
  await testInfo.attach('craft-dark-narrow', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByTestId('handover-pending-card').filter({ hasText: 'Read the source documents' }).getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByTestId('handover-pending-card')).toHaveCount(1);
  const response = await page.request.get(`${instance.endpoint}/api/desktop/handover`);
  expect((await response.json()).handover.pending).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test('scheduled deliveries can preview their exact Markdown results @agent-home @home-dashboard', async ({ page, instance }) => {
  await seedHandover(instance, 'typed');
  await openChat(page);
  const updates = page.getByRole('region', { name: 'Updates' });
  const briefing = updates.getByRole('article').filter({ hasText: 'Morning briefing' });
  await briefing.getByRole('button', { name: 'Quick preview' }).click();
  await expect(briefing.getByTestId('home-task-result')).toContainText('Three things worth your attention today.');
  const topics = updates.getByRole('article').filter({ hasText: 'Topic ideas' });
  await topics.getByRole('button', { name: 'Quick preview' }).click();
  await expect(topics.getByTestId('home-task-result')).toContainText('One recommended angle and two alternatives.');
  await expect(briefing.getByTestId('home-task-result')).toHaveCount(0);
});

test('home links to the original memory queue and keeps the draft @agent-home @home-memory', async ({ page, instance }) => {
  await seedHandover(instance, 'memory');
  await openChat(page);
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates).toContainText('3 new memories to review');
  const input = await composer(page).boundingBox();
  const feed = await updates.boundingBox();
  expect(input!.y + input!.height).toBeLessThan(feed!.y);
  await composer(page).fill('Keep this new-task draft');
  await updates.getByRole('button', { name: 'Open Memory Center', exact: true }).click();
  await page.getByText('Needs your review', { exact: true }).click();
  const candidate = page.getByRole('article').filter({ hasText: 'Put conclusions first' });
  await candidate.getByRole('button', { name: /Put conclusions first/ }).click();
  const editor = page.getByRole('dialog', { name: 'Edit candidate', exact: true });
  await editor.getByRole('textbox', { name: 'Content', exact: true }).fill('Show conclusions first and preserve the source evidence.');
  await editor.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => {
    const records = await page.request.post(`${instance.endpoint}/api/desktop/memory`, { data: { action: 'search', allScopes: true, query: 'Show conclusions first and preserve the source evidence.' } });
    return (await records.json()).items.some((item: { content: string }) => item.content === 'Show conclusions first and preserve the source evidence.');
  }).toBe(true);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(composer(page)).toHaveValue('Keep this new-task draft');
  await expect(updates).toContainText('2 new memories to review');
});

test('home keeps task outcomes and reads the exact execution with retry @agent-home', async ({ page }) => {
  let edition = 'home-execution';
  let reads = 0;
  let read = false;
  // This case tests per-execution receipts; isolate the legacy unload acknowledgment.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).includes('/api/desktop/handover/ack')
      ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
      : original(input, init);
  });
  await page.route('**/api/desktop/handover/ack', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/desktop/notifications', async route => {
    if (route.request().method() === 'POST') {
      read = true;
      return route.fulfill({ json: { ok: true, notifications: [] } });
    }
    const row = { id: 'n-task', type: 'task-result', dedupeKey: `task:home-task:${edition}`, refId: edition, payload: { taskId: 'home-task', executionId: edition, text: 'Daily outcome retained' }, status: 'unread', createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:00:00Z' };
    return route.fulfill({ json: { ok: true, notifications: read ? [] : [row] } });
  });
  await page.route('**/api/desktop/tasks', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.executionId).toBe(edition);
      if (body.executionId === 'home-execution' && ++reads === 1) return route.fulfill({ status: 500, json: { error: 'temporary' } });
      return route.fulfill({ json: { ok: true, session: { taskId: 'home-task', sessionId: 'home-source', messages: [{ role: 'assistant', content: 'Exact execution result', createdAt: '2026-11-01T01:00:00Z' }] } } });
    }
    return route.fulfill({ json: { ok: true, summary: { items: [{ id: 'home-row', taskId: 'home-task', category: 'user', systemKind: '', botId: 'another-agent', projectId: '', type: 'periodic', enabled: true, text: 'Daily outcome retained', status: 'pending', updatedAt: '2026-11-01T01:00:00Z', active: false, executions: [{ id: edition, status: 'completed', sessionId: 'home-source', runId: 'home-run', startedAt: '2026-11-01T01:00:00Z', attempt: 1, maxAttempts: 1 }] }], counts: { total: 1, byType: {}, byStatus: {}, byScope: {}, byChannel: {} }, targets: [] } } });
  });
  await openChat(page);
  const work = page.locator('.agent-home-work');
  await expect(work.getByRole('button', { name: 'Daily outcome retained' })).toBeVisible();
  await work.getByRole('button', { name: 'Daily outcome retained' }).click();
  await expect(work.getByRole('alert')).toBeVisible();
  await work.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(work.getByText('Exact execution result')).toBeVisible();
  await work.getByRole('button', { name: 'Continue chat', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not open the source conversation.');
  await expect(work.getByText('Exact execution result')).toBeVisible();
  expect(read).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await work.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: '.test-tmp/home-work-narrow.png', fullPage: true });
  await work.getByTestId('home-task-result').getByRole('button', { name: 'Collapse', exact: true }).click();
  // Closing the preview leaves the notification unread.
  await expect(page.getByRole('button', { name: 'Daily outcome retained', exact: true })).toBeVisible();
  await page.clock.install();
  await work.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(work.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.clock.fastForward(4500);
  await expect.poll(() => read).toBe(true);
  await expect(page.getByRole('button', { name: 'Daily outcome retained', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Daily outcome retained', exact: true })).toHaveCount(0);
  edition = 'home-next-execution';
  read = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Daily outcome retained', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.evaluate(() => {
    for (const [key, newValue] of [['molibot-desktop-locale', 'zh-CN'], ['molibot-desktop-appearance', 'dark'], ['molibot-desktop-theme-family', 'brutalism']]) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    }
  });
  await expect(page.getByRole('button', { name: '收起', exact: true })).toBeVisible();
  await work.screenshot({ path: '.test-tmp/home-work-cards-brutalism.png' });
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await page.clock.fastForward(4500);
  await expect.poll(() => read).toBe(true);
  await expect(page.getByRole('button', { name: 'Daily outcome retained', exact: true })).toHaveCount(0);

});

test('home result cards fit their content without reserved blank rows @agent-home', async ({ page, instance }, testInfo) => {
  // Polling cancels the durable-executions lookup mid-navigation; webkit reports it as an access-control error.
  testInfo.annotations.push({ type: 'expected-page-error', description: '/molibot-api/api/desktop/durable-executions due to access control checks' });
  await page.route('**/api/desktop/notifications', route => route.fulfill({ json: { ok: true, notifications: ['Short task', 'Long task instructions '.repeat(80)].map((text, i) => ({
    id: `size-${i}`, type: 'task-result', dedupeKey: `task:size-${i}:run-${i}`, refId: `run-${i}`, payload: { taskId: `size-${i}`, executionId: `run-${i}`, text }, status: 'unread', createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:00:00Z'
  })) } }));
  await page.route('**/api/desktop/plans?**', route => route.fulfill({ json: { ok: true, items: [], total: 0 } }));
  await openChat(page);
  const cards = page.getByRole('region', { name: 'Updates' }).getByRole('article').filter({ hasText: /Short task|Long task instructions/ });
  await expect(cards).toHaveCount(2);
  for (const width of [1440, 860, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect.poll(() => cards.first().evaluate(node => node.getBoundingClientRect().height), { message: `Compact short card at ${width}px` }).toBeLessThan(180);
    const bounds = await cards.evaluateAll(nodes => nodes.map(node => {
      const title = node.querySelector('.agent-home-work-title')!;
      const summary = node.querySelector('.agent-home-work-summary');
      return { height: node.getBoundingClientRect().height, titleHeight: title.getBoundingClientRect().height,
        limit: parseFloat(getComputedStyle(title).lineHeight) * 2,
        summaryTop: summary ? summary.getBoundingClientRect().top : title.getBoundingClientRect().bottom,
        titleBottom: title.getBoundingClientRect().bottom,
        actionsTop: node.querySelector('.agent-home-work-actions')!.getBoundingClientRect().top,
        summaryBottom: summary ? summary.getBoundingClientRect().bottom : title.getBoundingClientRect().bottom,
        buttonBottom: node.querySelector('.agent-home-work-actions')!.getBoundingClientRect().bottom - node.getBoundingClientRect().top };
    }));
    expect(bounds[0].height).toBeLessThan(180);
    expect(bounds[0].height).toBeLessThan(bounds[1].height);
    expect(bounds[1].titleHeight).toBeLessThanOrEqual(bounds[1].limit + 1);
    for (const card of bounds) {
      expect(card.summaryTop - card.titleBottom).toBeLessThanOrEqual(12);
      expect(card.actionsTop - card.summaryBottom).toBeLessThanOrEqual(12);
      expect(card.buttonBottom).toBeLessThan(card.height);
    }
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.evaluate(() => {
    for (const [key, newValue] of [['molibot-desktop-appearance', 'dark'], ['molibot-desktop-theme-family', 'brutalism']]) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    }
  });
  await expect(cards).toHaveCount(2);
  await page.locator('.agent-home-work').screenshot({ path: '.test-tmp/home-content-sized-cards.png' });
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await instance.restartService();
  await page.reload();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect.poll(() => cards.first().evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(180);
});

test('cross-channel card read state survives return and reload @agent-home', async ({ page, instance }, testInfo) => {
  await seedHandover(instance, 'cross-channel');
  // Restarts cancel in-flight model lookups mid-navigation; webkit reports them as access-control errors.
  for (const path of ['api/desktop/models?route=text', 'api/desktop/models?route=stt']) {
    testInfo.annotations.push({ type: 'expected-page-error', description: `/molibot-api/${path} due to access control checks` });
  }
  // The API read reconciles the notification row; the page-level handover is
  // pinned to this payload so the ack window cannot resolve the row mid-test.
  const payload = await (await page.request.get(`${instance.endpoint}/api/desktop/handover`)).json();
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).includes('/api/desktop/handover/ack')
      ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
      : original(input, init);
  });
  await page.route('**/api/desktop/handover', route => route.fulfill({ json: payload }));
  await openChat(page);
  const card = page.getByTestId('handover-cross-channel');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open history', exact: true }).click();
  await expect(page.locator('.agent-history-page')).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(card).toHaveCount(0);
  // Read state lives server-side: a reload and a service restart keep it read.
  await page.reload();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(card).toHaveCount(0);
  await instance.restartService();
  await page.reload();
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('two notification editions load only their own exact execution @agent-home', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  const payload = await (await page.request.get(`${instance.endpoint}/api/desktop/handover`)).json();
  const old = payload.handover.items.find((item: any) => item.kind === 'task-completed');
  expect(old.executionId).toBeTruthy();
  let denied = false;
  const requested: string[] = [];
  await page.route('**/api/desktop/notifications', route => route.fulfill({ json: { ok: true, notifications: [
    { id: 'n-original', text: 'Original edition card', executionId: old.executionId },
    { id: 'n-newer', text: 'Newer edition card', executionId: 'newer-edition' }
  ].map(({ id, text, executionId }) => ({
    id, type: 'task-result', dedupeKey: `task:${old.taskId}:${executionId}`, refId: executionId,
    payload: { taskId: old.taskId, executionId, text }, status: 'unread', createdAt: old.occurredAt, updatedAt: old.occurredAt
  })) } }));
  await page.route('**/api/desktop/tasks', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      requested.push(body.executionId);
      return denied ? route.fulfill({ status: 403, json: { ok: false, error: 'Access revoked' } }) : route.fulfill({ json: { ok: true, session: { taskId: old.taskId, sessionId: old.sessionId, messages: [{ role: 'assistant', content: body.executionId === old.executionId ? 'Original edition exact content' : 'Newer edition exact content', createdAt: old.occurredAt }] } } });
    }
    return route.fulfill({ json: { ok: true, summary: { items: [{ id: 'reader-row', taskId: old.taskId, category: 'user', systemKind: '', botId: 'default', projectId: '', type: 'periodic', enabled: true, text: 'Newer edition card', active: false, updatedAt: old.occurredAt, executions: [{ id: 'newer-edition', status: 'completed', sessionId: old.sessionId, runId: 'newer-run', startedAt: old.occurredAt }] }], targets: [], counts: { total: 1, byType: {}, byStatus: {}, byScope: {}, byChannel: {} } } } });
  });
  await openChat(page);
  await page.getByRole('button', { name: 'Original edition card', exact: true }).click();
  const reader = page.getByTestId('home-task-result');
  await expect(reader).toContainText('Original edition exact content');
  await expect(reader).not.toContainText('Newer edition exact content');
  expect(requested.at(-1)).toBe(old.executionId);
  await reader.getByRole('button', { name: 'Collapse', exact: true }).click();
  await page.getByRole('button', { name: 'Newer edition card', exact: true }).click();
  await expect(reader).toContainText('Newer edition exact content');
  expect(requested.at(-1)).toBe('newer-edition');
  await reader.getByRole('button', { name: 'Collapse', exact: true }).click();
  denied = true;
  await page.getByRole('button', { name: 'Original edition card', exact: true }).click();
  await expect(reader.getByRole('alert')).toBeVisible();
  await expect(reader).not.toContainText('Original edition exact content');
});

test('home plan card opens the exact persisted plan detail @agent-home', async ({ page, instance }) => {
  const title = `Home target plan ${Date.now()}`;
  const response = await page.request.post(`${instance.endpoint}/api/desktop/plans`, { data: { action: 'create', botId: 'default', title, summary: 'Exact home navigation target', tasks: [{ title: 'Review the result', steps: [{ title: 'Read retained evidence' }] }] } });
  expect(response.ok(), await response.text()).toBe(true);
  const created = (await response.json()).item;
  const planId = created.execution.id;
  let detailUnavailable = true;
  await page.route('**/api/desktop/plans?stream=true', route => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"heartbeat"}\n\n' }));
  await page.route(`**/api/desktop/plans?id=${planId}`, route => detailUnavailable
    ? route.fulfill({ status: 403, json: { ok: false, error: 'Plan detail temporarily unavailable' } }) : route.continue());
  await openChat(page);
  // The plan is waiting for its first approval, so it surfaces as a pending card; open the plan from there.
  await page.getByTestId('handover-pending-card').getByRole('button', { name: title, exact: true }).click();
  await expect(page.locator('.plans-detail').getByRole('alert')).toContainText('Plan detail temporarily unavailable');
  detailUnavailable = false;
  await page.locator('.plans-detail').getByRole('alert').getByRole('button').click();
  await expect(page.locator('.plans-detail h2')).toHaveText(title);
  await expect(page.locator('.plans-detail')).toContainText('Exact home navigation target');
  const read = await page.request.get(`${instance.endpoint}/api/desktop/plans?id=${planId}`);
  expect((await read.json()).item.execution.id).toBe(planId);
});

test('memory center keeps confirmation disabled until the original can be compared @agent-home @home-memory', async ({ page, instance }) => {
  await seedHandover(instance, 'memory-comparison');
  let comparisons = 0;
  let originalAvailable = true;
  await page.route('**/api/desktop/memory', async route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    if (body.action !== 'compare-candidate') return route.continue();
    if (++comparisons === 1) return route.fulfill({ status: 503, json: { ok: false, error: 'Unavailable' } });
    return route.fulfill({ json: { ok: true, comparison: { candidateId: body.id, candidateUpdatedAt: body.expectedUpdatedAt, originals: [{ relation: 'replaces', available: originalAvailable, ...(originalAvailable ? { content: 'Previously preferred long introductions.' } : {}) }] } } });
  });
  await openChat(page);
  await page.getByRole('button', { name: 'Open Memory Center', exact: true }).click();
  await page.getByText('Needs your review', { exact: true }).click();
  const candidate = page.getByRole('article').filter({ hasText: 'Put conclusions first' });
  const openEditor = candidate.getByRole('button', { name: /Put conclusions first/ });
  await openEditor.click();
  const editor = page.getByRole('dialog', { name: 'Edit candidate', exact: true });
  const save = editor.getByRole('button', { name: 'Save memory', exact: true });
  await expect(save).toBeDisabled();
  await expect(editor.getByRole('alert')).toBeVisible();
  await editor.getByRole('button', { name: 'Retry', exact: true }).click();
  const comparison = editor.getByRole('region', { name: 'Memory comparison' });
  await expect(comparison).toContainText('Previously preferred long introductions.');
  await expect(save).toBeEnabled();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  originalAvailable = false;
  await openEditor.click();
  await expect(comparison).toContainText('deleted or is outside the current scope');
  await expect(save).toBeDisabled();
});

test('an immediate page change preserves the full window to undo a dismissal @agent-home', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/desktop/notifications', async route => {
    if (route.request().method() === 'POST') writes++;
    await route.fulfill({ json: { ok: true, notifications: [{
      id: 'undo-home', type: 'task-result', refId: 'undo-home-run', dedupeKey: 'undo-home',
      payload: { text: 'Undo this outcome', executionId: 'undo-home-run' }, status: 'unread',
      createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:00:00Z'
    }] } });
  });
  await openChat(page);
  const home = page.getByRole('region', { name: 'Momo', exact: true });
  const dismiss = home.getByRole('button', { name: 'Dismiss', exact: true });
  await expect(dismiss).toBeVisible();
  await page.clock.install();
  await dismiss.click();
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('region', { name: 'UI Second', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await home.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dismiss).toBeVisible();
  await page.clock.fastForward(4500);
  expect(writes).toBe(0);
});

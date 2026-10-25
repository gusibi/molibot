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

async function seedHandover(instance: IsolatedInstance, scenario: 'active' | 'busy' | 'history' | 'quiet' | 'first-run' | 'cross-channel' | 'external-source' | 'editorial'): Promise<void> {
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
  const avatar = await page.locator('.agent-home-identity .agent-avatar').first().boundingBox();
  expect(Math.round(avatar?.width ?? 0)).toBe(96);
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
  await expect(page.getByTestId('handover-summary')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.agent-home-history')).toContainText('No conversations yet');
  await expect(composer(page)).toBeEnabled();
});

test('the Default Agent home reports completed work and expands it into entries, while other Agents keep the start form @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toContainText('1 finished');
  await expect(page.getByTestId('handover-pending')).toContainText('Handover approval');
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.locator('.agent-home-handover')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
});

test('replies already read on another channel collapse into one card @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'cross-channel');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toContainText('Nothing needs your decision');
  const card = page.getByTestId('handover-cross-channel');
  await expect(card).toContainText('Replied to 3 messages on other channels');
  await expect(card).toContainText('Feishu, WeChat');
  await expect(page.getByTestId('handover-entries')).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
});

test('leaving the handover immediately still shows the same entries on return @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
});

test('resolving a pending approval in the handover removes it without a local ghost @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-pending')).toContainText('Handover approval');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByTestId('handover-pending')).toHaveCount(0);
});

test('a quiet day uses the same start form as every other Agent @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'quiet');
  await openChat(page);
  await expect(page.getByTestId('handover-summary')).toHaveCount(0);
  await expect(page.locator('.agent-home-handover')).toHaveCount(0);
  await expect(page.locator('.agent-home-tasks').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.agent-home-history')).toContainText('No conversations yet');
  await expect(page.getByText(/Next: Quiet briefing/)).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
});

test('a service interruption keeps the last handover visible and marks it stale @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');

  await instance.stopService();
  try {
    await expect(page.getByText('Not updated · service unreachable')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  } finally {
    await instance.startService();
  }
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UI Second' })).toBeVisible();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(page.getByText('Not updated · service unreachable')).toHaveCount(0);
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
  await expect(page.getByTestId('handover-summary')).toContainText('完成了 1 件');
  await expect(page.getByTestId('handover-entries')).toContainText('Handover UI task');
  await expect(page.getByTestId('handover-pending')).toContainText('等你决定');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a busy day shows one hero, compact results, a short failure reason and three pending decisions @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'busy');
  await openChat(page);

  await expect(page.getByTestId('handover-summary')).toContainText('6 finished');
  const entries = page.getByTestId('handover-entries');
  // One hero plus three compact rows; the remaining two wait behind the expander.
  await expect(entries.locator('[data-handover-row]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Show 2 more', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show 2 more', exact: true }).click();
  await expect(entries.locator('[data-handover-row]')).toHaveCount(6);
  await expect(entries.locator('.agent-home-hero')).toContainText('Busy task 1');

  // The failure reads as a reason, and the diagnostic is cut before it reaches the page.
  await expect(page.getByText('Model sign-in failed: the API key is invalid or expired')).toBeVisible();
  const detail = page.locator('.agent-home-failure-detail').first();
  await expect(detail).not.toContainText('provider=cli-proxy-api');
  expect((await detail.innerText()).length).toBeLessThanOrEqual(220);

  const executions = page.getByRole('table', { name: 'Recent executions' });
  await expect(executions.getByRole('row')).toHaveCount(6);
  await page.getByRole('button', { name: 'Show 2 more executions', exact: true }).click();
  await expect(executions.getByRole('row')).toHaveCount(8);

  // Three decisions first; the rest is one click away.
  const pending = page.getByTestId('handover-pending');
  await expect(pending.getByText('Busy approval 1', { exact: true })).toBeVisible();
  await expect(pending.getByText('Busy approval 4', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '3 more', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '3 more', exact: true }).click();
  await expect(pending.getByText('Busy approval 6', { exact: true })).toBeVisible();
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
    await expect(fresh.getByTestId('handover-summary')).toBeVisible();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Momo' })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('finished work spans days without repeating the list layout @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'history');
  await openChat(page);

  const entries = page.getByTestId('handover-entries');
  await expect(entries).toContainText('Grouped task today');
  await expect(entries).toContainText('Grouped task yesterday');
  await expect(entries.locator('[data-handover-row]')).toHaveCount(2);
});

test('arrow keys walk the cards and focus peeks the clamped failure detail @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'busy');
  await openChat(page);

  const cards = page.locator('[data-handover-row]');
  await cards.first().locator('button').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(1).locator('button').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cards.first().locator('button').first()).toBeFocused();

  // The diagnostic is clamped at rest and opens while its own card holds focus.
  const failure = page.locator('.agent-home-failure').first();
  const detail = failure.locator('.agent-home-failure-detail');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await detail.evaluate((node) => getComputedStyle(node).webkitLineClamp)).toBe('2');
  await failure.locator('button').first().focus();
  expect(await detail.evaluate((node) => getComputedStyle(node).webkitLineClamp)).toBe('none');
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
  await page.getByTestId('handover-entries').getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect(page.locator('.chat-header')).toContainText('External source title');
  await expect(page.getByText('Source conversation no longer exists')).toHaveCount(0);
});

test('a waiting row opens its own session instead of the history list @agent-home @handover', async ({ page, instance }) => {
  await seedHandover(instance, 'active');
  await openChat(page);

  await page.getByTestId('handover-pending').getByText('Handover approval', { exact: true }).click();
  await expect(page.locator('.agent-home')).toHaveCount(0);
  await expect(page.locator('.chat-header')).toContainText('Handover seed');
  await expect(composer(page)).toBeVisible();
});


test('work home puts readable results beside decisions and adapts to the workspace @agent-home @home-dashboard', async ({ page, instance }, testInfo) => {
  await seedHandover(instance, 'active');
  await page.setViewportSize({ width: 1440, height: 1024 });
  await openChat(page);
  const results = page.getByRole('region', { name: 'Recent results', exact: true });
  const decisions = page.getByRole('region', { name: 'Waiting on you', exact: true });
  await expect(results).toContainText('Handover UI task');
  await expect(decisions).toContainText('Handover approval');
  const resultBox = await results.boundingBox();
  const decisionBox = await decisions.boundingBox();
  expect(decisionBox!.x).toBeGreaterThan(resultBox!.x + resultBox!.width);
  expect(Math.abs(resultBox!.y - decisionBox!.y)).toBeLessThan(2);
  const executions = page.getByRole('table', { name: 'Recent executions' });
  await expect(executions.getByRole('row')).toHaveCount(2);
  await expect(executions).toContainText('Handover UI task');
  await expect(executions).toContainText('Done');
  await expect(composer(page)).toHaveAttribute('placeholder', 'Give me something new to work on…');
  await decisions.getByText('View command and scope', { exact: true }).click();
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

  await page.setViewportSize({ width: 1120, height: 900 });
  await expect.poll(async () => {
    const r = await results.boundingBox();
    const d = await decisions.boundingBox();
    return Boolean(d && r && d.y + d.height <= r.y);
  }).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer(page)).toBeEnabled();
  await expect.poll(async () => (await page.locator('.agent-home--brief').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(350);
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
  await expect(page.getByRole('region', { name: '最近成果', exact: true })).toContainText('Handover UI task');
  await expect(page.getByRole('table', { name: '最近执行记录' })).toContainText('已完成');
  await expect(composer(page)).toHaveAttribute('placeholder', '交给我一件新事…');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
  expect(await page.locator('.agent-home-hero').evaluate(node => getComputedStyle(node).borderRadius)).toBe('0px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach('work-home-zh-dark-square', { body: await page.screenshot(), contentType: 'image/png' });
  const translatedDecisions = page.getByRole('region', { name: '等你决定', exact: true });
  await translatedDecisions.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(translatedDecisions).toHaveCount(0);
  await expect.poll(async () => {
    const response = await page.request.get(`${instance.endpoint}/api/desktop/handover`);
    return (await response.json()).handover.pending.length;
  }).toBe(0);
  await expect(page.getByRole('region', { name: '最近成果', exact: true })).toContainText('Handover UI task');
});


test('the work home reads as one composed workspace across sizes and themes @agent-home @home-craft', async ({ page, instance }, testInfo) => {
  await seedHandover(instance, 'editorial');
  await page.setViewportSize({ width: 1440, height: 1024 });
  await openChat(page);
  await expect(page.getByRole('heading', { name: 'Weekly research brief', level: 3 })).toBeVisible();
  await expect(page.getByTestId('handover-summary')).toContainText('3 finished');
  await expect(page.getByTestId('handover-pending')).toContainText('Read the source documents');
  await expect(page.getByTestId('handover-pending').getByRole('article')).toHaveCount(2);
  await expect(page.getByTestId('handover-entries')).toContainText('Clear completion criteria');
  await expect(page.getByTestId('handover-entries')).toContainText('Took 45s');
  const headings = await page.getByRole('heading', { level: 2 }).evaluateAll(nodes => nodes.filter(n => ['Recent results', 'Waiting on you'].includes(n.textContent ?? '')).map(n => n.getBoundingClientRect().y));
  expect(headings).toHaveLength(2);
  expect(Math.abs(headings[0] - headings[1])).toBeLessThan(1);
  const input = await composer(page).boundingBox();
  const workspace = await page.locator('.agent-home--brief').boundingBox();
  expect(input!.width).toBeGreaterThan(workspace!.width * .9);
  expect(await page.locator('.agent-home--brief .composer').evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1024);
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
  await page.getByTestId('handover-pending').getByRole('article').filter({ hasText: 'Read the source documents' }).getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByTestId('handover-pending')).not.toContainText('Read the source documents');
  const response = await page.request.get(`${instance.endpoint}/api/desktop/handover`);
  expect((await response.json()).handover.pending).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

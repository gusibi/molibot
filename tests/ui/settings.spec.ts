import { test, expect } from './support/fixtures';
import { composer, openChat, openSettings } from './support/actions';

/**
 * Field-level settings round-trip through the real UI: save, leave and return,
 * restart, and confirm an unrelated part of the configuration is intact. The
 * test restores the original mode so it cannot leak into a later case in the
 * shared worker instance.
 */
test('the default execution mode saves, survives restart and does not clobber other settings @settings', async ({ page, instance }) => {
  await openChat(page);
  await openSettings(page);

  const openExecution = async () => {
    await page.getByRole('button', { name: 'Execution & permissions', exact: true }).click();
  };
  const mode = (name: RegExp) => page.getByRole('radiogroup', { name: 'Default execution mode' }).getByRole('radio', { name });

  await openExecution();
  await expect(mode(/Manual/)).toHaveAttribute('aria-checked', 'true');
  await mode(/Auto/).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  // Leave the section and come back: the saved value is shown.
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await openExecution();
  await expect(mode(/Auto/)).toHaveAttribute('aria-checked', 'true');

  // Restart the service and read the value back.
  await instance.restartService();
  await page.reload();
  await openSettings(page);
  await openExecution();
  await expect(page.getByRole('radiogroup', { name: 'Default execution mode' }).getByRole('radio', { name: /Auto/ })).toHaveAttribute('aria-checked', 'true');

  // An unrelated part of the configuration survived the save.
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByText(/Total agents: 2/)).toBeVisible();

  // Restore the seeded default so later cases in this worker see Manual again.
  await openExecution();
  await mode(/Manual/).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(mode(/Manual/)).toHaveAttribute('aria-checked', 'true');
});

/**
 * The app-logo picker is instant-apply, localStorage-backed UI state (same
 * lifecycle as appearance): pick a badge, see it take over the settings footer
 * and the chat sidebar without a save round, and still be there after a cold
 * reload. Ends back on the default so shared-worker cases are not affected.
 */
test('the app logo picker swaps the identity mark live and survives a cold reload @settings', async ({ page }) => {
  await openChat(page);
  const footerLogo = page.locator('.sidebar-footer-logo');
  await expect(footerLogo.first()).toHaveAttribute('src', '/molibot-icon.png');

  await openSettings(page);
  const picker = page.locator('.logo-grid');
  const sleeping = picker.getByRole('button', { name: 'Sleeping', exact: true });
  await expect(sleeping).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sleeping.click();
  await expect(sleeping).toHaveAttribute('aria-pressed', 'true');

  // Live takeover inside settings and in the chat sidebar behind it.
  await expect(page.getByRole('dialog').getByRole('img', { name: /Molibot · / })).toHaveAttribute('src', '/logos/01-sleeping.webp');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(footerLogo.first()).toHaveAttribute('src', '/logos/01-sleeping.webp');

  // Cold path: a fresh page load re-reads the persisted pick.
  await page.reload();
  await expect(footerLogo.first()).toHaveAttribute('src', '/logos/01-sleeping.webp');

  // Restore the default mark for the cases that share this worker.
  await openSettings(page);
  await picker.getByRole('button', { name: 'Default', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(footerLogo.first()).toHaveAttribute('src', '/molibot-icon.png');
});

/**
 * The settings sidebar footer mirrors the chat sidebar's: one shared
 * AppFooterMark (status ring dot on the logo, no idle "ready" line) plus a
 * single trailing control. That control is the Agent entry — it leaves
 * settings for the default agent's home page (where the app opens) instead of
 * re-offering settings the user is already inside.
 */
test('the settings footer agents control closes settings on the default agent page @settings', async ({ page }) => {
  await openChat(page);
  await openSettings(page);

  await page.getByRole('button', { name: 'Go to Agents', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(composer(page)).toBeVisible();

  // The unified mark shows the picked app logo with its status ring, and the
  // footer carries no idle status text next to the name.
  await openSettings(page);
  const footer = page.getByRole('dialog').locator('.settings-sidebar-footer');
  await expect(footer.locator('.sidebar-footer-logo')).toBeVisible();
  await expect(footer).not.toContainText(/已就绪|Ready|Online|Offline/);
  await expect(footer.getByRole('button', { name: 'Go to Agents', exact: true })).toBeVisible();
});

/**
 * Per-bot display overrides round-trip through the channel editor: set them,
 * see the row mark them as customized, clear them back to follow-global, and
 * confirm the cleared state survives a service restart.
 */
test('a channel bot keeps its own display settings, survives restart, and returns to follow-global @settings', async ({ page, instance }) => {
  // The channel editor is the tallest settings dialog; resizing it fires the
  // chat page's ResizeObservers behind the overlay and WebKit reports the
  // browser-internal "loop completed" notice as a page error. Benign noise.
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  // The restart below races the reload's in-flight fetches; WebKit surfaces the
  // aborted requests as access-control errors (same allowance as chat.spec).
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  await openChat(page);
  await openSettings(page);

  // Channels lives in the Assistant group, directly below Agents — no separate
  // "Channels" group label and no "Web Profiles" entry anymore.
  const nav = page.locator('.settings-sidebar nav');
  await expect(nav.getByRole('button', { name: 'Channels', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Web Profiles', exact: true })).toHaveCount(0);
  const navOrder = await nav.locator('p.settings-nav-group-label, button.settings-nav').evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
  expect(navOrder[navOrder.indexOf('Agents') + 1]).toBe('Channels');
  const groupLabels = await nav.locator('p.settings-nav-group-label').allTextContents();
  expect(groupLabels).not.toContain('Channels');

  await page.getByRole('button', { name: 'Channels', exact: true }).click();

  // Web is a channel group of its own, listed first, and empty in a fresh instance.
  await expect(page.locator('section[aria-label="Web"]')).toBeVisible();

  const telegramGroup = page.locator('section[aria-label="Telegram"]');
  const dialog = page.locator('.entity-editor-dialog');
  const botRow = telegramGroup.locator('.settings-row', { hasText: 'QA Display Bot' });

  // Create a bot and override two display fields.
  await telegramGroup.getByRole('button', { name: 'Add instance', exact: true }).click();
  await dialog.getByLabel('Instance name').fill('QA Display Bot');
  await dialog.getByRole('button', { name: 'Tool progress', exact: true }).click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await dialog.getByLabel('Channel notification interval (seconds)').fill('30');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Channel instance saved.')).toBeVisible();

  // The row marks the bot as customized and the editor re-reads saved values.
  await expect(botRow).toContainText('custom display');
  await botRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Tool progress', exact: true })).toHaveText('Off');
  await expect(dialog.getByLabel('Channel notification interval (seconds)')).toHaveValue('30');

  // Clearing every override returns the bot to follow-global and the marker goes away.
  await dialog.getByRole('button', { name: 'Tool progress', exact: true }).click();
  await page.getByRole('option', { name: /Follow global/ }).first().click();
  await dialog.getByLabel('Channel notification interval (seconds)').fill('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Channel instance saved.')).toBeVisible();
  await expect(botRow).not.toContainText('custom display');

  // The cleared state survives a service restart (persisted, not just in-memory).
  await instance.restartService();
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Channels', exact: true }).click();
  await botRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Tool progress', exact: true })).toContainText('Follow global');
  await expect(dialog.getByLabel('Channel notification interval (seconds)')).toHaveValue('');

  // Chinese, dark theme and mobile width render the new section without overflow.
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  await page.getByRole('button', { name: '渠道', exact: true }).click();
  const zhRow = page.locator('section[aria-label="Telegram"]').locator('.settings-row', { hasText: 'QA Display Bot' });
  await zhRow.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByText('显示与通知')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '工具执行进度', exact: true })).toContainText('跟随全局');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/**
 * Web is a channel like the others but with the reduced editor: identity,
 * linked agent, enable state and Markdown files only — no chat allowlist, no
 * display overrides, no platform credentials. The instance persists across a
 * service restart like any external bot.
 */
test('a Web instance edits through the channel editor with the reduced form and survives restart @settings', async ({ page, instance }) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  await openChat(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Channels', exact: true }).click();

  const webGroup = page.locator('section[aria-label="Web"]');
  const dialog = page.locator('.entity-editor-dialog');

  await webGroup.getByRole('button', { name: 'Add instance', exact: true }).click();
  await dialog.getByLabel('Instance name').fill('QA Web Space');
  await expect(dialog.getByLabel('Allowed chat IDs')).toHaveCount(0);
  await expect(dialog.getByText('Display & notifications')).toHaveCount(0);
  await expect(dialog.getByText('Platform credentials')).toHaveCount(0);
  await expect(dialog.getByText('Bot Markdown overrides')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Channel instance saved.')).toBeVisible();

  const webRow = webGroup.locator('.settings-row', { hasText: 'QA Web Space' });
  await expect(webRow).toBeVisible();

  await instance.restartService();
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Channels', exact: true }).click();
  await expect(webGroup.locator('.settings-row', { hasText: 'QA Web Space' })).toBeVisible();
});

import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

test('settings appearance and navigation stay usable across layouts @settings-polish', async ({ page, instance }, testInfo) => {
  // Reload cancels the handover acknowledgement in WebKit during pagehide.
  test.info().annotations.push({ type: 'expected-page-error', description: '/molibot-api/api/desktop/handover/ack due to access control checks' });
  await openChat(page);
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await expect(nav.getByRole('button', { name: 'General', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: testInfo.outputPath('settings-start.png') });
  await search.fill('no matching settings');
  await expect(nav.getByRole('button')).toHaveCount(0);
  await expect(page.locator('.settings-search-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Clear settings search' }).click();
  await expect(nav.getByRole('button')).toHaveCount(26);
  await nav.getByRole('button', { name: 'AI Providers', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'AI Providers', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'General', exact: true }).click();
  const appearance = page.locator('.appearance-card');
  const alignAppearance = () => appearance.evaluate(el => {
    const scroll = el.closest('.settings-scroll')!;
    scroll.scrollTop += el.closest('section')!.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
  });
  await appearance.scrollIntoViewIfNeeded();
  const theme = appearance.locator('.theme-family-grid').first().getByRole('button').first();
  await theme.focus();
  await page.keyboard.press('Enter');
  await expect(theme).toHaveAttribute('aria-pressed', 'true');
  await expect(theme.locator('.appearance-selected')).toBeVisible();
  await page.locator('.appearance-label').first().click();
  await alignAppearance();
  await page.screenshot({ path: testInfo.outputPath('settings-appearance.png') });
  const brightness = page.getByRole('radiogroup', { name: 'Brightness', exact: true });
  await brightness.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png') });
  await page.setViewportSize({ width: 860, height: 620 });
  await alignAppearance();
  expect(await appearance.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-narrow.png') });
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await instance.restartService();
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  await expect(page.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await alignAppearance();
  await page.screenshot({ path: testInfo.outputPath('settings-chinese.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await alignAppearance();
  expect(await appearance.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.appearance-segmented').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-small.png') });
  expect(await page.locator('.settings-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('shared settings layout keeps forms and save actions within the reading column @settings-polish', async ({ page }, testInfo) => {
  await openChat(page);
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  for (const name of ['Models', 'AI Providers', 'Execution & permissions', 'MCP']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    await expect(page.locator('.settings-scroll .skeleton-rows')).toHaveCount(0);
    await expect(page.locator('.settings-scroll').getByText('Loading…', { exact: true })).toHaveCount(0);
    expect(await page.locator('.settings-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-${name.replace(/[^a-z]/gi, '-').toLowerCase()}.png`) });
  }
  await page.setViewportSize({ width: 860, height: 620 });
  await nav.getByRole('button', { name: 'Execution & permissions', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Default execution mode' }).getByRole('radio', { name: /Plan/ }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
  expect(await page.locator('.settings-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-permissions-narrow.png') });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
});

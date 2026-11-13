import { test, expect } from './support/fixtures';
import { openSettings } from './support/actions';

/**
 * The "Answer style" control is a user-facing choice, so assert the real
 * settings UI rather than just the CSS attribute. Covers click, persistence,
 * cold start and switching back.
 */
test('answer style switches in appearance settings and survives reload @chat', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  // General is the default settings page; the control lives in its
  // Appearance section, not behind a separate "Theme" navigation item.
  await openSettings(page);

  const group = page.getByRole('radiogroup', { name: 'Answer style', exact: true });
  await expect(group.getByRole('radio', { name: 'Feishu Docs', exact: true })).toHaveAttribute('aria-checked', 'true');

  await group.getByRole('radio', { name: 'Notion', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-doc-style', 'notion');
  expect(await page.evaluate(() => localStorage.getItem('molibot-desktop-doc-style'))).toBe('notion');

  // Cold start must read the saved preference with no flash of the default.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-doc-style', 'notion');

  await openSettings(page);
  await page.getByRole('radiogroup', { name: 'Answer style', exact: true })
    .getByRole('radio', { name: 'Feishu Docs', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-doc-style', 'feishu');
});

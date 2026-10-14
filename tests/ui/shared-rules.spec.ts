import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

test('shared rules save through the native-approved API and survive service restart @settings', async ({ page, instance }) => {
  const marker = `# AGENTS.md\n\nShared rule ${test.info().testId}`;
  await openChat(page); await openSettings(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('region', { name: 'Shared configuration', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'AGENTS.md', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'AGENTS.md', exact: true }).fill(marker);
  const saved = page.waitForResponse(response => response.url().includes('/api/desktop/profile-files') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('region', { name: 'Shared configuration', exact: true })).toBeVisible();
  await instance.restartService(); await page.reload(); await openSettings(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('region', { name: 'Shared configuration', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'AGENTS.md', exact: true })).toHaveValue(marker);
});

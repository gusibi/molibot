import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

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

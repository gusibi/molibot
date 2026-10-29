import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

/**
 * Regression coverage for the two lane-configuration pages that share the
 * settings overview pattern: a vector lane round-trips through the editor and
 * the decision-model editor keeps the Auto selection after a save. Both tests
 * use only the isolated instance and never call a real provider.
 */
test('a vector lane saves from the dialog and can be deleted @settings', async ({ page, instance }) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  await openChat(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Embedding Models', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'No vector lanes yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Add vector lane', exact: true }).first().click();
  const dialog = page.locator('.embedding-editor');
  await expect(dialog).toBeVisible();

  // Missing required fields stay local to the dialog and do not close it.
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Name / Host URL / Model');

  await dialog.getByLabel('Name').fill('QA Vector Lane');
  await dialog.getByLabel('Host URL').fill('http://127.0.0.1:11434');
  await dialog.getByLabel('Model').fill('bge-m3:latest');
  await expect(dialog).toContainText('http://127.0.0.1:11434/v1/embeddings');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  const lane = page.locator('.embedding-lane', { hasText: 'QA Vector Lane' });
  await expect(lane).toBeVisible();
  await expect(page.getByText('Vector lane saved.')).toBeVisible();

  // Leaving and returning reads the lane back from the service.
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Embedding Models', exact: true }).click();
  await expect(page.locator('.embedding-lane', { hasText: 'QA Vector Lane' })).toBeVisible();

  // Cold path: a service restart must not leave the page empty or stale.
  await instance.restartService();
  await page.reload();
  await openChat(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Embedding Models', exact: true }).click();
  await expect(page.locator('.embedding-lane', { hasText: 'QA Vector Lane' })).toBeVisible();

  // Deletion goes through the shared confirm dialog and restores the empty state.
  await page.locator('.embedding-lane', { hasText: 'QA Vector Lane' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('.desktop-dialog-content', { hasText: 'Delete this vector lane?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No vector lanes yet' })).toBeVisible();
  await expect(page.getByText('Vector lane deleted.')).toBeVisible();
});

test('the decision page keeps the Auto model after save and reload @settings', async ({ page }) => {
  await openChat(page);
  await openSettings(page);

  const original = await page.evaluate(async () => {
    const config = await fetch('/molibot-api/api/settings/adaptive-thinking').then((response) => response.json());
    const decisionModels = (config.decisionModels ?? []).map((model: any) =>
      model.provider === 'siliconflow'
        ? { ...model, enabled: true, modelId: 'diffusiongemma' }
        : { ...model, enabled: model.provider !== 'llm' }
    );
    await fetch('/molibot-api/api/settings/adaptive-thinking', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        defaultStrategy: 'auto',
        decisionModels,
        selectedDecisionModelId: 'siliconflow',
        maxThinkingLevel: 'high',
        fallbackThinkingLevel: 'medium',
        confidenceThreshold: 0.6,
        timeoutMs: 1500,
        apiKeys: { siliconflow: 'qa-decision-key', jev: 'qa-jev-key' },
        clearApiKeys: []
      })
    });
    return config;
  });

  try {
    await page.getByRole('button', { name: 'Decision Models', exact: true }).click();
    await expect(page.getByText('Adaptive thinking is on')).toBeVisible();

    const jev = page.locator('.decision-model', { hasText: 'Jev' });
    await jev.getByRole('button', { name: 'Use for Auto', exact: true }).click();
    await expect(jev).toContainText('In use');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Decision model settings saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Embedding Models', exact: true }).click();
    await page.getByRole('button', { name: 'Decision Models', exact: true }).click();
    await expect(page.locator('.decision-model', { hasText: 'Jev' })).toContainText('In use');
  } finally {
    // The worker instance is shared: put the decision configuration back.
    await page.evaluate(async (config: any) => {
      await fetch('/molibot-api/api/settings/adaptive-thinking', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          enabled: false,
          defaultStrategy: 'fixed',
          selectedDecisionModelId: '',
          decisionModels: (config.decisionModels ?? []).map((model: any) => ({ ...model, enabled: false })),
          apiKeys: {},
          clearApiKeys: ['siliconflow', 'jev']
        })
      });
    }, original);
  }
});

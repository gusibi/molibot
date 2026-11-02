import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

test('provider verification feedback stays beside Check with a long model list @settings', async ({ page, instance }) => {
  await instance.restartService();
  await page.route('**/api/desktop/providers', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    const provider = payload.summary.customProviders.find((provider: { id: string }) => provider.id === 'ui-test');
    provider.models = Array.from({ length: 40 }, (_, index) => ({ ...provider.models[0], id: `fixture-${index}` }));
    provider.modelCount = provider.models.length;
    await route.fulfill({ response, json: payload });
  });
  let ok = true;
  await page.route('**/api/desktop/provider-test', route => route.fulfill({ json: { ok, error: ok ? undefined : 'Fixture connection refused' } }));
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'AI Providers', exact: true }).click();
  await page.getByRole('tab', { name: 'Self-hosted providers', exact: true }).click();
  await page.locator('.provider-rail-list').getByRole('button', { name: /UI Test/ }).click();
  const check = page.locator('.provider-input-action');
  const feedback = page.locator('.provider-pane-message');
  await check.click();
  await expect(feedback).toContainText('verified');
  await expect(feedback).toBeInViewport();
  const buttonBox = await check.boundingBox();
  const resultBox = await feedback.boundingBox();
  expect(resultBox!.y - (buttonBox!.y + buttonBox!.height)).toBeLessThan(100);
  ok = false;
  await check.click();
  await expect(feedback).toContainText('Fixture connection refused');
  await expect(feedback).toHaveClass(/run-history-failed/);
  await expect(feedback).toBeInViewport();
});

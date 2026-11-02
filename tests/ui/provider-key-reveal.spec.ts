import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

test('saved provider keys reveal on demand without becoming edits @settings', async ({ page, instance }) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'due to access control checks' });
  await instance.restartService();
  await openChat(page);
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  await nav.getByRole('button', { name: 'AI Providers', exact: true }).click();
  await page.getByRole('tab', { name: 'Self-hosted providers', exact: true }).click();
  await page.locator('.provider-rail-list').getByRole('button', { name: /UI Test/ }).click();
  const field = page.locator('.provider-field', { has: page.getByText('API Key', { exact: true }) });
  const input = field.locator('input.provider-input');
  await expect(input).toHaveValue('');
  await field.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(input).toHaveValue('local-ui-test');
  await expect(input).toHaveAttribute('type', 'text');
  await field.getByRole('button', { name: 'Hide API key', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('type', 'password');
  await field.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(input).toHaveValue('local-ui-test');
  // The save bar exists only for dirty drafts; revealing must not create one.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await field.getByRole('button', { name: 'Hide API key', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('replacement-fixture');
  await field.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(input).toHaveValue('replacement-fixture');
  // Discard the local replacement before exercising navigation and recovery.
  await input.fill('');
  await nav.getByRole('button', { name: 'General', exact: true }).click();
  await nav.getByRole('button', { name: 'AI Providers', exact: true }).click();
  await page.getByRole('tab', { name: 'Self-hosted providers', exact: true }).click();
  await page.locator('.provider-rail-list').getByRole('button', { name: /UI Test/ }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Show API key', exact: true })).toBeVisible();
  await instance.restartService();
  await expect(page.getByRole('img', { name: 'Molibot · Online', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(page.locator('.provider-input-group input')).toHaveValue('local-ui-test');
});

test('provider key reveal rejects late replies and recovers from read errors @settings', async ({ page }) => {
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'AI Providers', exact: true }).click();
  await page.getByRole('tab', { name: 'Self-hosted providers', exact: true }).click();
  await page.locator('.provider-rail-list').getByRole('button', { name: /UI Test/ }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/desktop/providers', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'reveal-api-key') return route.continue();
    requested();
    await gate;
    await route.fulfill({ json: { ok: true, apiKey: 'late-fixture' } });
  });
  await page.getByRole('button', { name: 'Show API key', exact: true }).click();
  await started;
  await page.getByRole('checkbox', { name: 'Clear saved API key', exact: true }).check();
  const replied = page.waitForResponse(response => response.url().endsWith('/api/desktop/providers') && response.request().method() === 'POST');
  release();
  await replied;
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('checkbox', { name: 'Clear saved API key', exact: true }).uncheck();
  await page.unroute('**/api/desktop/providers');
  await page.route('**/api/desktop/providers', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { ok: false, error: 'fixture unavailable' } });
    await route.continue();
  });
  await page.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not read the saved API key');
  await page.unroute('**/api/desktop/providers');
  await page.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('local-ui-test');
});

test('saved API keys require an explicit reveal and stay out of provider summaries @settings', async ({ request, instance }) => {
  const url = `${instance.endpoint}/api/desktop/providers`;
  const reveal = (id: string) => request.post(url, { data: { action: 'reveal-api-key', id } });
  expect((await reveal('')).status()).toBe(400);
  expect((await reveal('missing-fixture-provider')).status()).toBe(404);
  const created = await request.post(url, { data: { id: 'opencode-go', name: 'OpenCode Go', apiKey: 'fixture-opencode', enabled: true, models: [] } });
  expect(created.ok()).toBe(true);
  for (const [id, expected] of [['ui-test', 'local-ui-test'], ['opencode-go', 'fixture-opencode']]) {
    const response = await reveal(id);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect((await response.json()).apiKey).toBe(expected);
  }
  const summary = await request.get(url);
  const body = await summary.text();
  expect(body).not.toContain('local-ui-test');
  expect(body).not.toContain('fixture-opencode');
  expect(body).not.toContain('"apiKey"');
});

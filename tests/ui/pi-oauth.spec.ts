import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';
import { startFixture, oauthServer } from '../../evals/lib/oauthFixture';

test('OAuth survives page changes, locale changes and isolated service restart', async ({ page, context, instance }) => {
  let entered!: () => void; let release!: () => void;
  const exchange = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const fixture = await startFixture({ beforeTokenExchange: async () => { entered(); await barrier; } });
  try {
    const response = await context.request.put(`${instance.endpoint}/api/settings/mcp`, { headers: { Origin: instance.endpoint }, data: { mcpServers: [oauthServer('pi-ui', fixture.mcpUrl)] } });
    expect(response.ok(), await response.text()).toBe(true);
    await openChat(page); await openSettings(page);
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(page.getByText('OAuth authorization: Not authorized', { exact: true })).toBeVisible();
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await popup; await exchange;
    await page.getByRole('button', { name: 'General', exact: true }).click();
    release();
    await page.getByRole('button', { name: 'Interface language', exact: true }).click();
    await page.getByRole('option', { name: '简体中文', exact: true }).click();
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(page.getByText('OAuth 授权: 已授权', { exact: true })).toBeVisible();
    await expect(page.getByText('已授权', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('button', { name: '界面语言', exact: true }).click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(page.getByText('Authorized', { exact: true })).toBeVisible();
    await expect(page.getByText('Loaded tools: 2', { exact: true })).toBeVisible();
    await instance.restartService();
    await page.reload();
    await openSettings(page); await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(page.getByText('OAuth authorization: Authorized', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-authorize', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    const authorization = await page.getByText('OAuth authorization: Authorized', { exact: true }).boundingBox();
    const action = await page.getByRole('button', { name: 'Re-authorize', exact: true }).boundingBox();
    expect(authorization).not.toBeNull(); expect(action).not.toBeNull();
    expect(action!.y).toBeGreaterThanOrEqual(authorization!.y + authorization!.height);
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    await page.screenshot({ path: '.test-tmp/pi/oauth-narrow.png', fullPage: true });
  } finally { release(); await fixture.close(); }
});

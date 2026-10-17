import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from './support/fixtures';
import { openSettings } from './support/actions';

test('forced migration skips errors, reports backups and survives cold restart @recovery', async ({ page, instance }) => {
  await instance.stopService();
  const put = async (path: string, body: string) => {
    const file = join(instance.dataDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  };
  for (const chat of ['web:default:owner', 'web:default:other']) {
    await put(`moli-w/bots/default/${chat}/contexts/same.json`, '[]');
  }
  await put('moli-w/bots/default/web:default:owner/contexts/broken.json', '[]');
  const broken = 'moli-w/bots/default/web:default:owner/contexts/broken.meta.json';
  await put(broken, 'invalid');
  const database = join(instance.dataDir, 'db/legacy-migration.sqlite');
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE session_lifecycle(session_id TEXT PRIMARY KEY); INSERT INTO session_lifecycle VALUES ('same')");
  db.close();
  await instance.startService();
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Migrate Agent session data' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm migration', exact: true })).toBeDisabled();
  const rejected = await page.request.post(`${instance.endpoint}/api/desktop/storage-migration`, { data: { action: 'confirm' } });
  expect(rejected.status()).toBe(409);
  await page.setViewportSize({ width: 520, height: 700 });
  await page.evaluate(() => {
    for (const [key, newValue] of [['molibot-desktop-appearance', 'dark'], ['molibot-desktop-locale', 'zh-CN']]) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
    }
  });
  await expect(page.locator('html')).toHaveAttribute('data-resolved-appearance', 'dark');
  await expect(page.getByRole('button', { name: '强制迁移（跳过异常项）', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('migration-zh-dark-narrow.png') });
  await page.evaluate(() => {
    localStorage.setItem('molibot-desktop-locale', 'en-US');
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'en-US', storageArea: localStorage }));
  });
  const force = dialog.getByRole('button', { name: 'Force migration (skip errors)', exact: true });
  await expect(force).toBeInViewport();
  await force.click();
  await expect(dialog.getByRole('heading', { name: 'Skipped items', exact: true })).toBeVisible();
  await dialog.getByText('View skipped items', { exact: true }).click();
  await expect(dialog.getByText(/Ambiguous persistent Session reference/).first()).toBeVisible();
  const done = await (await page.request.get(`${instance.endpoint}/api/desktop/storage-migration`)).json();
  expect(done.needed).toBe(false);
  expect(done.skippedIssues.length).toBeGreaterThan(0);
  const result = new DatabaseSync(database, { readOnly: true });
  expect(result.prepare('SELECT count(*) AS n FROM session_lifecycle').get()!.n).toBe(0);
  expect(result.prepare('SELECT count(*) AS n FROM agent_storage_skipped_rows').get()!.n).toBe(1);
  result.close();
  expect(await readFile(join(instance.dataDir, broken), 'utf8')).toBe('invalid');
  expect(await readFile(join(instance.dataDir, 'sessions/default/contexts/same.json'), 'utf8')).toBe('[]');
  await dialog.getByRole('button', { name: 'Done, open app', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openSettings(page);
  await instance.restartService();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Momo', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect((await (await page.request.get(`${instance.endpoint}/api/desktop/storage-migration`)).json()).needed).toBe(false);
});

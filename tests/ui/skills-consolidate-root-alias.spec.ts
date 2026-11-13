import { mkdir, writeFile, symlink, readdir, readlink, realpath, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { test, expect } from './support/fixtures';

test('consolidation recognizes a platform root link and protects the shared copy @workspace', async ({ page, request, instance }, testInfo) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  const shared = join(instance.home, '.agents', 'skills');
  const claude = join(instance.home, '.claude', 'skills');
  const path = join(shared, 'root-alias');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), '---\nname: root-alias\ndescription: root link fixture\n---\none shared body\n');
  await mkdir(dirname(claude), { recursive: true });
  try { await symlink(shared, claude); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    expect((await lstat(claude)).isSymbolicLink()).toBe(true);
    expect(await realpath(claude)).toBe(await realpath(shared));
  }
  await instance.restartService();
  const before = await readdir(shared);
  await page.goto('/');
    await expect(page.getByTestId('chat-composer')).toBeEnabled();
  const nav = page.getByRole('navigation', { name: 'Chat', exact: true });
  await nav.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('group', { name: 'Skills', exact: true }).getByRole('button', { name: /^Discover & install/ }).click();
  const card = page.locator('.installed-skill-card').filter({ hasText: 'root-alias' });
  await card.click();
  await page.locator('.skills-detail').getByRole('button', { name: 'Consolidate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Consolidate into a shared folder', exact: true });
  await expect(dialog.getByText('Already sharing one copy', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Parent directory is already a link', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Replace original with link', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Confirm shared state', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove entry', exact: true }).click();
  await expect(dialog.getByText(/Removing it would remove the shared content/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm shared state', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Replace original with link', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.resolvedAppearance = 'dark';
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const chinese = page.getByRole('dialog', { name: '整理到共享目录', exact: true });
  await expect(chinese.getByText('已共享一份内容', { exact: true })).toBeVisible();
  await expect(chinese.getByLabel('父目录已是链接', { exact: true })).toBeVisible();
  const width = await chinese.locator(".skills-sheet-body").evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await page.screenshot({ path: testInfo.outputPath('root-alias-shared-state-zh-dark.png') });
  await chinese.getByRole('button', { name: '确认共享状态', exact: true }).click();
  await expect(chinese.getByText('已共享一份内容', { exact: true })).toBeVisible();
  expect(await readdir(shared)).toEqual(before);
  expect(await readlink(claude)).toBe(shared);
  expect(await realpath(join(claude, 'root-alias'))).toBe(await realpath(path));
  expect((await lstat(path)).isDirectory()).toBe(true);
  const payload = await (await request.get(instance.endpoint + '/api/desktop/skill-manager')).json();
  expect(payload.summary.discovered.find((entry: { name: string }) => entry.name === 'root-alias').inSharedDir).toBe(true);
  await chinese.getByRole('button', { name: '关闭', exact: true }).last().click();
  const chineseNav = page.getByRole('navigation', { name: '对话', exact: true });
  await chineseNav.getByRole('button', { name: '自动任务', exact: true }).click();
  await chineseNav.getByRole('button', { name: '技能', exact: true }).click();
  await page.getByRole('group', { name: '技能', exact: true }).getByRole('button', { name: /^其他平台/ }).click();
  await instance.stopService();
  await instance.startService();
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await expect(page.locator('.installed-skill-card').filter({ hasText: 'root-alias' })).toHaveCount(1);
  expect(await realpath(join(claude, 'root-alias'))).toBe(await realpath(path));
});

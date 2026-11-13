import { mkdir, writeFile, symlink, lstat, realpath, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { test, expect } from './support/fixtures';

test('consolidation keeps its geometry and latest preview through rapid changes and failures @workspace', async ({ page, instance }, testInfo) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  await page.addInitScript(() => localStorage.setItem('molibot-desktop-low-performance', 'false'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const shared = join(instance.home, '.agents', 'skills');
  await mkdir(join(shared, 'polish-skill'), { recursive: true });
  await writeFile(join(shared, 'polish-skill', 'SKILL.md'), '---\nname: polish-skill\ndescription: interaction fixture\n---\nbody');
  const claude = join(instance.home, '.claude', 'skills');
  await mkdir(dirname(claude), { recursive: true });
  await symlink(shared, claude);
  let release: (() => void) | undefined;
  let hold = false, failNext = false;
  await page.route('**/api/desktop/skill-manager', async route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body?.action !== 'consolidate-preflight') return route.continue();
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { ok: false, error: 'Preview temporarily unavailable' } }); }
    const response = await route.fetch();
    if (hold && body.request.sourceAction === 'remove') await new Promise<void>(done => { release = done; });
    await route.fulfill({ response });
  });
  try {
    await page.goto('/');
    await expect(page.getByTestId('chat-composer')).toBeEnabled();
    await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByRole('group', { name: 'Skills', exact: true }).getByRole('button', { name: /^Discover & install/ }).click();
    await page.locator('.installed-skill-card').filter({ hasText: 'polish-skill' }).click();
    await page.locator('.skills-detail').getByRole('button', { name: 'Consolidate', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Consolidate into a shared folder', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Confirm shared state', exact: true });
    await expect(confirm).toBeEnabled();
    // Sample after entrance completion; the content transition is what this guard measures.
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const marker = dialog.locator('.consolidate-selection');
    expect(await marker.evaluate(el => getComputedStyle(el).transitionDuration)).not.toBe('0s');
    const initial = (await dialog.boundingBox())!;
    const footer = (await confirm.boundingBox())!;
    await dialog.screenshot({ animations: "disabled", path: testInfo.outputPath('consolidate-light.png') });
    hold = true;
    await dialog.getByRole('button', { name: 'Remove entry', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(dialog.getByText('polish-skill', { exact: true })).toBeVisible();
    await expect(confirm).toBeDisabled();
    const pending = (await dialog.boundingBox())!;
    expect(Math.abs(pending.height - initial.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(pending.y - initial.y)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Keep a copy', exact: true }).click();
    await expect(confirm).toBeEnabled();
    const late = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/desktop/skill-manager') && response.request().postDataJSON()?.action === 'consolidate-preflight' && response.request().postDataJSON()?.request.sourceAction === 'remove');
    release?.(); hold = false;
    await late;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(confirm).toBeEnabled();
    await expect(dialog.getByText(/Removing it would remove the shared content/)).toHaveCount(0);
    expect(Math.abs((await confirm.boundingBox())!.y - footer.y)).toBeLessThanOrEqual(1);
    failNext = true;
    await dialog.getByRole('button', { name: 'Replace original with link', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Preview temporarily unavailable');
    await expect(dialog.getByText('polish-skill', { exact: true })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: 'Retry preview', exact: true }).click();
    await expect(confirm).toBeEnabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dataset.resolvedAppearance = 'dark';
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
    });
    const chinese = page.getByRole('dialog', { name: '整理到共享目录', exact: true });
    await expect(chinese.getByRole('button', { name: '确认共享状态', exact: true })).toBeEnabled();
    const width = await chinese.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    await chinese.screenshot({ animations: "disabled", path: testInfo.outputPath('consolidate-dark-mobile.png') });
    await chinese.getByRole('button', { name: '取消', exact: true }).click();
    await expect(chinese).toHaveCount(0);
    const opener = page.locator('.skills-detail').getByRole('button', { name: '整理', exact: true });
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(chinese.getByRole('button', { name: '确认共享状态', exact: true })).toBeEnabled();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await chinese.locator('.consolidate-selection').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    await chinese.getByRole('button', { name: '保留副本', exact: true }).click();
    await expect(chinese.getByRole('button', { name: '确认共享状态', exact: true })).toBeEnabled();
    await chinese.getByRole('button', { name: '取消', exact: true }).click();
    await expect(chinese).toHaveCount(0);
    const trigger = page.locator('.skills-detail').getByRole('button', { name: '整理', exact: true });
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(chinese).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chinese).toHaveCount(0);
  } finally { release?.(); }
});


test('consolidation previews exact paths and keeps the shell stable after a real deduplication @workspace', async ({ page, request, instance }, testInfo) => {
  const source = join(instance.home, '.codex', 'skills', 'actual-dedup');
  const target = join(instance.home, '.agents', 'skills', 'actual-dedup');
  for (const path of [source, target]) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), '---\nname: actual-dedup\ndescription: real deduplication fixture\n---\nbody');
  }
  await page.goto('/');
    await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('group', { name: 'Skills', exact: true }).getByRole('button', { name: /^Discover & install/ }).click();
  await page.locator('.installed-skill-card').filter({ hasText: 'actual-dedup' }).filter({ hasText: 'Codex' }).click();
  await page.locator('.skills-detail').getByRole('button', { name: 'Consolidate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Consolidate into a shared folder', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Consolidate', exact: true });
  await expect(confirm).toBeEnabled();
  await dialog.getByText('View full paths', { exact: true }).click();
  await expect(dialog.getByText(source, { exact: true })).toBeVisible();
  await expect(dialog.getByText(target, { exact: true })).toBeVisible();
  const before = (await dialog.boundingBox())!;
  const footer = (await confirm.boundingBox())!;
  await confirm.press('Enter');
  await expect(dialog.getByText('Consolidated', { exact: true })).toBeVisible();
  expect((await lstat(source)).isSymbolicLink()).toBe(true);
  expect(await realpath(source)).toBe(await realpath(target));
  expect((await readdir(dirname(source))).some(name => name.startsWith('actual-dedup.backup-'))).toBe(true);
  expect(Math.abs((await dialog.boundingBox())!.height - before.height)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeFocused();
  const completedButton = (await dialog.getByRole('button', { name: 'Close', exact: true }).last().boundingBox())!;
  expect(Math.abs(completedButton.y - footer.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(completedButton.x - footer.x)).toBeLessThanOrEqual(1);
  const summary = (await (await request.get(instance.endpoint + '/api/desktop/skill-manager')).json()).summary;
  expect(summary.discovered.find((entry: { name: string }) => entry.name === 'actual-dedup').inSharedDir).toBe(true);
  await dialog.screenshot({ animations: "disabled", path: testInfo.outputPath('consolidate-success.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.locator('.installed-skill-card').filter({ hasText: 'actual-dedup' })).toBeFocused();
});

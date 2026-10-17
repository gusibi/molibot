import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('Agent save keeps the current category and file until explicit return @settings', async ({ page, instance }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Role and rules', exact: true }).click();
  const file = page.getByRole('textbox', { name: 'AGENTS.md', exact: true });
  const marker = `# AGENTS.md\n\nSaved in place ${test.info().testId}`;
  await file.fill(marker);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await expect(file).toHaveValue(marker);
  await expect(page.getByRole('button', { name: 'Role and rules', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('status')).toHaveText('Agent saved.');

  await file.fill(`${marker}\nSecond save`);
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Agent saved.');
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Back to Agent', exact: true }).click();
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await instance.restartService();
  await page.reload();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Role and rules', exact: true }).click();
  await expect(file).toHaveValue(`${marker}\nSecond save`);
});

test('Agent save failure keeps the draft and allows retry in place @settings', async ({ page }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click();
  await page.getByRole('button', { name: 'Role and rules', exact: true }).click();
  const file = page.getByRole('textbox', { name: 'AGENTS.md', exact: true });
  const marker = `# Retry ${test.info().testId}`;
  await file.fill(marker);
  await page.route('**/api/desktop/profile-files', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'Test save failure' } });
    else await route.continue();
  });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Some settings were saved');
  await expect(file).toHaveValue(marker);
  await expect(save).toBeEnabled();
  await page.unroute('**/api/desktop/profile-files');
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Agent saved.');
  await expect(file).toHaveValue(marker);
});

test('Agent save retains a selected file in Chinese dark mode at mobile width @settings', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await openChat(page);
  await page.getByRole('button', { name: 'Agent 设置', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '角色与规则', exact: true }).click();
  await page.getByRole('button', { name: '配置文件', exact: true }).click();
  await page.getByRole('option', { name: '表达风格 · SOUL.md', exact: true }).click();
  const file = page.getByRole('textbox', { name: 'SOUL.md', exact: true });
  const marker = `# Voice ${test.info().testId}`;
  await file.fill(marker);
  const save = page.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Agent 已保存。');
  await expect(file).toHaveValue(marker);
  await expect(page.getByRole('button', { name: '配置文件', exact: true })).toContainText('SOUL.md');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

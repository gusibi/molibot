import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('sidebar separates collaboration and keeps navigation aligned at minimum window size', async ({ page, instance }, testInfo) => {
  await instance.restartService();
  await openChat(page);
  const sidebar = page.locator('.chat-sidebar');
  await expect(sidebar.getByRole('heading', { name: 'Collaboration', exact: true })).toBeVisible();
  const geometry = await sidebar.evaluate(element => {
    const nav = element.querySelector('.nav-item')!;
    const section = element.querySelector('.sidebar-section-toggle')!;
    const metrics = (row: Element) => {
      const icon = row.querySelector('svg')!.getBoundingClientRect();
      const label = row.querySelector('span')!.getBoundingClientRect();
      const style = getComputedStyle(row);
      return { height: row.getBoundingClientRect().height, iconX: icon.x, iconWidth: icon.width, labelX: label.x, gap: label.x - icon.right, fontSize: style.fontSize };
    };
    return { nav: metrics(nav), section: metrics(section) };
  });
  expect(geometry.nav.height).toBe(36);
  expect(geometry.section.height).toBe(36);
  expect(geometry.nav.iconWidth).toBe(18);
  expect(geometry.section.iconWidth).toBe(18);
  expect(geometry.nav.gap).toBe(12);
  expect(geometry.section.gap).toBe(12);
  expect(geometry.nav.labelX).toBe(geometry.section.labelX);
  expect(geometry.nav.fontSize).toBe(geometry.section.fontSize);
  const agentRows = sidebar.locator('.agent-navigation .conv-group-head');
  await expect(agentRows).toHaveCount(3);
  const rowBounds = await agentRows.evaluateAll(rows => rows.map(row => {
    const bounds = row.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }));
  for (let index = 1; index < rowBounds.length; index++) {
    expect(rowBounds[index].top).toBeCloseTo(rowBounds[index - 1].bottom, 1);
  }
  await page.screenshot({ path: testInfo.outputPath('sidebar-layout.png') });
  await page.setViewportSize({ width: 860, height: 620 });
  await expect(sidebar.getByRole('button', { name: 'Projects', exact: true }).filter({ hasText: 'Projects' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Molibot · Online', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(sidebar.getByRole('heading', { name: 'Collaboration', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(sidebar.getByRole('heading', { name: 'Collaboration', exact: true })).toBeVisible();
  await instance.restartService();
  await expect(sidebar.getByRole('button', { name: 'Molibot · Online', exact: true })).toBeVisible({ timeout: 30_000 });
  const chineseContext = await page.context().browser()!.newContext({ viewport: { width: 860, height: 620 } });
  await chineseContext.addInitScript(() => {
    localStorage.setItem('molibot-desktop-first-launch-seen', '1');
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  try {
    const chinesePage = await chineseContext.newPage();
    await chinesePage.goto(instance.frontend);
    await expect(chinesePage.getByRole('heading', { name: '协作', exact: true })).toBeVisible();
    await chinesePage.screenshot({ path: testInfo.outputPath('sidebar-zh-dark.png') });
  } finally {
    await chineseContext.close();
  }
});

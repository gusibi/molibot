import type { APIRequestContext } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

async function post(request: APIRequestContext, endpoint: string, path: string, data: unknown) {
  const response = await request.post(endpoint + path, { headers: { origin: endpoint }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('independent task workspace keeps its split, filters, themes and cold recovery @workspace @smoke', async ({ page, request, instance }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Morning report ${suffix}`;
  const created = await post(request, instance.endpoint, '/api/desktop/tasks', {
    action: 'create', task: { kind: 'channel', channel: 'web', botId: 'default', chatId: `ui-${suffix}`, scope: 'workspace', text: `${title}\nSummarize the local fixture.`, delivery: 'text', schedule: '0 8 1 1 *', timezone: 'Asia/Shanghai', sessionMode: 'fresh' }
  });
  const taskId = created.affected[0];
  await page.setViewportSize({ width: 1440, height: 940 });
  await openChat(page);
  await page.getByRole('button', { name: 'Auto tasks', exact: true }).click();
  const row = page.getByRole('button', { name: title, exact: true });
  await expect(row).toBeVisible();
  const header = page.locator(".chat-header");
  await expect(header.getByRole("button", { name: "Create automation", exact: true })).toHaveText("");
  const refresh = header.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toHaveText("");
  await expect(header.getByLabel("More actions", { exact: true })).toHaveCount(0);
  const refreshed = page.waitForResponse(response => response.url().endsWith("/api/desktop/tasks") && response.request().method() === "GET");
  await refresh.click();
  expect((await refreshed).ok()).toBe(true);
  await expect(page.locator(".automation-workspace > .workspace-description")).toContainText("Create and manage scheduled");
  const before = await row.boundingBox();
  await expect(page.locator('.workspace-empty-art .startup-city')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tasks-unselected.png') });
  await page.setViewportSize({ width: 1600, height: 940 });
  expect((await row.boundingBox())!.width).toBeCloseTo(before!.width, 0);
  await page.setViewportSize({ width: 1440, height: 940 });
  await row.click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const after = await row.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 0);
  await expect(page.locator('.workspace-scroll').getByRole('tab')).toHaveCount(0);
  await expect(page.locator('.chat-header').getByRole('button', { name: 'Task categories', exact: true })).toHaveCount(0);
  const categories = page.getByRole('group', { name: 'Task categories', exact: true });
  const periodic = categories.getByRole('button').nth(0);
  await expect(categories.getByRole('button')).toHaveCount(4);
  await expect(periodic).toHaveAttribute('aria-pressed', 'true');
  await categories.getByRole('button').nth(2).click();
  await expect(categories.getByRole('button').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toHaveCount(0);
  await periodic.click();
  await expect(periodic).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await page.locator('.chat-header').getByRole('button', { name: 'Filter automations', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Filter automations', exact: true });
  await expect(search).toBeFocused();
  await search.fill('no-such-task');
  await expect(row).toHaveCount(0);
  await search.press('Escape');
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter automations', exact: true })).toBeFocused();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Filter automations', exact: true }).click();
  await search.fill(title);
  await row.click();

  for (const [family, appearance] of [['macos', 'dark'], ['macos', 'light'], ['terminal', 'dark'], ['win98', 'light'], ['brutalism', 'light'], ['raft', 'light']]) {
    await page.evaluate(({ family, appearance }) => {
      document.documentElement.dataset.themeFamily = family;
      document.documentElement.dataset.resolvedAppearance = appearance;
    }, { family, appearance });
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const selected = await row.evaluate(element => {
      const text = element.querySelector('strong')!;
      return { bg: getComputedStyle(element).backgroundColor, fg: getComputedStyle(text).color, width: element.getBoundingClientRect().width };
    });
    expect(selected.bg).not.toBe(selected.fg);
    expect(selected.width).toBeCloseTo(after!.width, 0);
    await page.screenshot({ path: testInfo.outputPath(`tasks-${family}-${appearance}.png`) });
  }
  await page.evaluate(async () => {
    const themePath = '/src/lib/theme/vscodeTheme.ts';
    const stylePath = '/src/lib/theme/themeStyle.ts';
    const { parseVscodeTheme, buildThemeTokens } = await import(/* @vite-ignore */ themePath);
    const { applyImportedThemeStyle } = await import(/* @vite-ignore */ stylePath);
    const parsed = parseVscodeTheme(JSON.stringify({ name: 'UI imported', type: 'dark', colors: { 'editor.background': '#252830', 'editor.foreground': '#eeeeee', 'sideBar.background': '#292d35', 'list.activeSelectionBackground': '#3d557b' } }));
    applyImportedThemeStyle(document, { id: 'ui-workspace', name: parsed.name, variant: 'dark', source: parsed.name, importedAt: '2026-10-15T00:00:00Z', tokens: buildThemeTokens(parsed) });
    document.documentElement.dataset.themeFamily = 'imported-ui-workspace';
    document.documentElement.dataset.resolvedAppearance = 'dark';
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
  });
  await expect(page.getByRole('button', { name: '自动任务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tasks-imported-zh.png') });
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'en-US' })));
  await page.setViewportSize({ width: 860, height: 620 });
  await expect(row).not.toBeVisible();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(row).toBeVisible();
  await expect(search).toHaveValue(title);
  await row.click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const overflow = await page.locator('.workspace-scroll').evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);

  // Pause through the actual action menu and confirm the persisted scheduling state.
  await page.locator('.automation-task-detail').getByLabel('More actions', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => {
    const response = await request.get(instance.endpoint + '/api/desktop/tasks');
    const payload = await response.json();
    return payload.summary.items.find((item: { id: string }) => item.id === taskId)?.enabled;
  }).toBe(false);
  await expect(page.locator('.automation-task-detail').getByText('Paused', { exact: true }).first()).toBeVisible();
  await instance.restartService();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Auto tasks', exact: true }).click();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Paused');
  await post(request, instance.endpoint, '/api/desktop/tasks', { action: 'delete', ids: [taskId] });
});

test('skills, plans and launcher remain separate pages with real actions and empty search @workspace', async ({ page, request, instance }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const skillName = `Workspace Skill ${suffix}`;
  const skillDir = join(instance.dataDir, 'skills', `workspace-${suffix}`);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: Local workspace UI fixture with a short description.\n---\nUse the local fixture.\n`);
  for (const [index, name] of ['Review code', 'Write notes', 'Plan work', 'Inspect files', 'Read documents'].entries()) {
    const directory = join(instance.dataDir, 'skills', `catalog-${suffix}-${index}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Organize local workspace information with clear steps and a focused result.\n---\nUse local fixture data.\n`);
  }
  await post(request, instance.endpoint, '/api/desktop/miniapps/builtin', { appId: 'note' });
  const planTitle = `Workspace plan ${suffix}`;
  await post(request, instance.endpoint, '/api/desktop/plans', {
    action: 'create', planId: `workspace-${suffix}`, botId: 'default', title: planTitle, summary: 'Review the local document.',
    tasks: [{ title: 'Read document', steps: [{ title: 'Read local input' }, { title: 'Check result' }] }],
    acceptanceCriteria: [{ description: 'Result matches input', required: true }]
  });
  await page.setViewportSize({ width: 1440, height: 940 });
  await openChat(page);
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.locator('.chat-header').getByRole('button', { name: 'Search skills', exact: true }).click();
  await page.getByRole('searchbox').fill(skillName);
  await expect(page.getByText(skillName, { exact: true })).toBeVisible();
  const toggle = page.getByRole('checkbox', { name: new RegExp(skillName) });
  await toggle.focus();
  const skillUpdated = page.waitForResponse(response => response.url().endsWith('/api/desktop/skills') && response.request().method() === 'PUT');
  await toggle.press('Space');
  expect((await skillUpdated).ok()).toBe(true);
  await expect(toggle).not.toBeChecked();
  const skillState = await (await request.get(instance.endpoint + '/api/desktop/skills')).json();
  expect(skillState.summary.items.find((item: { name: string }) => item.name === skillName)?.enabled).toBe(false);
  await page.getByRole('searchbox').fill('');
  const filters = page.getByRole('group', { name: 'Scope', exact: true });
  await filters.getByRole('button', { name: /^Built-in Skills/ }).click();
  await expect(toggle).toHaveCount(0);
  await filters.getByRole('button', { name: /^Workspace/ }).click();
  await expect(toggle).toBeVisible();
  await expect(filters.getByRole('button', { name: /^Workspace/ })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: /^All/ }).click();
  await expect(toggle).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('skills.png') });
  await page.getByRole('searchbox').fill('no-such-skill');
  await expect(toggle).toHaveCount(0);
  await expect(page.locator('.workspace-scroll').getByRole('tab')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.locator('.workspace-empty-art .startup-city')).toBeVisible();
  await expect(page.locator('.plans-shell > .workspace-description')).toHaveText('Review, edit, and continue plans generated from a session.');
  await page.screenshot({ path: testInfo.outputPath('plans-unselected.png') });
  await page.locator('.chat-header').getByRole('button', { name: 'Search plans', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(planTitle) }).click();
  await expect(page.getByRole('heading', { name: planTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await page.screenshot({ path: testInfo.outputPath('plans.png') });
  await page.setViewportSize({ width: 860, height: 620 });
  await expect(page.getByRole('button', { name: 'Read local input', exact: true })).toHaveCount(0);
  await page.locator('.plans-back').click();
  await expect(page.getByRole('searchbox', { name: 'Search plans', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search plans', exact: true }).fill('no-such-plan');
  await expect(page.getByText('No plans match.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Mini Apps', exact: true }).click();
  await expect(page.locator('.plans-shell')).toHaveCount(0);
  await page.locator('.chat-header').getByRole('button', { name: 'Search Mini Apps', exact: true }).click();
  await expect(page.locator('.chat-header').getByRole('searchbox')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('no-such-miniapp');
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await page.getByRole('searchbox').press('Escape');
  await page.locator('.miniapps-launchpad-grid').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath('miniapps.png') });
  await expect(page.locator('.chat-header').getByRole('button', { name: 'Manage Mini Apps', exact: true })).toHaveCount(0);
  const toolbar = page.locator('.miniapps-launchpad-toolbar');
  const manage = toolbar.getByRole('button', { name: 'Manage Mini Apps', exact: true });
  await expect(manage).toHaveText('');
  const countBox = await toolbar.locator('.workspace-filter-count').boundingBox();
  const manageBox = await manage.boundingBox();
  expect(countBox!.x + countBox!.width).toBeLessThan(manageBox!.x);
  await manage.click();
  const back = toolbar.getByRole('button', { name: 'Back to Launchpad', exact: true });
  await expect(back).toBeVisible();
  await expect(page.locator('.chat-header').getByRole('button', { name: 'Back to Launchpad', exact: true })).toHaveCount(0);
  const backBox = await back.boundingBox();
  expect(backBox!.x).toBeCloseTo(manageBox!.x, 0);
  expect(backBox!.y).toBeCloseTo(manageBox!.y, 0);
  const aiSettings = page.getByRole('button', { name: 'Mini App AI', exact: true });
  await expect(aiSettings).toHaveText('');
  await expect(aiSettings).toHaveAttribute('title', /Choose host models/);
  expect((await aiSettings.boundingBox())!.width).toBeLessThan(45);
  await aiSettings.hover();
  await page.screenshot({ path: testInfo.outputPath('miniapps-management.png') });
  await aiSettings.click();
  await expect(page.getByRole('heading', { name: 'Mini App AI', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(back).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.themeFamily = 'macos';
    document.documentElement.dataset.resolvedAppearance = 'dark';
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
  });
  const localizedSettings = page.getByRole('button', { name: '小程序 AI', exact: true });
  await expect(localizedSettings).toHaveAttribute('title', /选择小程序调用的宿主模型/);
  await expect(toolbar.getByRole('button', { name: '返回启动台', exact: true })).toBeVisible();
  expect(await page.locator('.workspace-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('miniapps-management-zh-dark.png') });
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'en-US' })));
  await back.click();
  await expect(page.locator('.chat-header').getByRole('button', { name: 'Search Mini Apps', exact: true })).toBeVisible();
});

test('plan revisions preserve drafts, reject conflicts and survive cold recovery @workspace @plans @recovery', async ({ page, request, instance }, testInfo) => {
  const planId = `edit-${randomUUID().slice(0, 8)}`;
  const title = `Plan ${planId}`;
  await post(request, instance.endpoint, '/api/desktop/plans', { action: 'create', planId, agentId: 'default', botId: 'default', title, tasks: [{ title: 'Original task', steps: [{ title: 'Original step' }] }] });
  const readPlan = async () => (await (await request.get(instance.endpoint + `/api/desktop/plans?id=${planId}`)).json()).item;
  await openChat(page);
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  const row = page.locator('.plans-list').getByRole('button', { name: new RegExp(title) });
  await row.click();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Owner draft');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Step 2', exact: true }).fill('Check output');
  await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Keep draft and close', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await row.click();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('Owner draft');
  const before = await readPlan();
  await post(request, instance.endpoint, '/api/desktop/plans', { action: 'edit', executionId: planId, expectedVersion: before.execution.version, title, summary: 'Changed elsewhere', tasks: before.tasks, acceptanceCriteria: [{ description: 'Owner checks output' }] });
  await expect(page.getByRole('alert')).toContainText('The plan has changed');
  await expect(page.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('Owner draft');
  await page.getByRole('button', { name: 'Review against latest version', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preview changes', exact: true })).toContainText('Owner draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Owner draft', exact: true })).toBeVisible();
  expect((await readPlan()).tasks[0].steps).toHaveLength(2);
  expect((await readPlan()).execution.status).toBe('planned');
  await page.setViewportSize({ width: 390, height: 740 });
  await page.evaluate(() => { document.documentElement.dataset.resolvedAppearance = 'dark'; window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' })); });
  await page.getByRole('button', { name: '编辑计划', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '计划名称', exact: true })).toHaveValue('Owner draft');
  expect(await page.locator('.plans-detail').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('plan-editor-zh-dark-narrow.png') });
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await instance.restartService();
  await expect(page.getByRole('heading', { name: 'Owner draft', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑计划', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '计划名称', exact: true })).toHaveValue('Owner draft');
  await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
  expect((await readPlan()).meta.title).toBe('Owner draft');
});

test('plans, skills and auto tasks align their top sections and count each filter @workspace @smoke', async ({ page, request, instance }, testInfo) => {
  const title = `Filter counts ${randomUUID().slice(0, 8)}`;
  await post(request, instance.endpoint, '/api/desktop/plans', {
    action: 'create', planId: `counts-${randomUUID()}`, botId: 'default', title,
    tasks: [{ title: 'Read document', steps: [{ title: 'Read input' }] }]
  });
  await openChat(page);
  for (const [locale, family, appearance] of [['en-US', 'macos', 'light'], ['zh-CN', 'macos', 'dark'], ['zh-CN', 'brutalism', 'dark']]) {
    await page.evaluate(({ locale, family, appearance }) => {
      document.documentElement.dataset.themeFamily = family;
      document.documentElement.dataset.resolvedAppearance = appearance;
      localStorage.setItem('molibot-desktop-locale', locale);
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, family, appearance });
    for (const width of [1440, 1120, 860]) {
    await page.setViewportSize({ width, height: 940 });
    await page.getByRole('button', { name: locale === 'en-US' ? 'Auto tasks' : '自动任务', exact: true }).click();
    const tasks = page.locator('.automation-workspace');
    await expect(tasks.locator('.workspace-task-filters')).toBeVisible();
    const taskGeometry = await tasks.evaluate(element => {
      const description = element.querySelector('.workspace-description')!.getBoundingClientRect();
      const filters = element.querySelector('.workspace-filterbar')!.getBoundingClientRect();
      return { descriptionY: description.y, descriptionH: description.height, filtersY: filters.y, filtersH: filters.height, dividerY: filters.bottom };
    });
    await page.getByRole('button', { name: locale === 'en-US' ? 'Skills' : '技能', exact: true }).click();
    const skills = page.locator('.skills-shell');
    await expect(skills.locator('.workspace-skill-filters')).toBeVisible();
    await expect(skills.locator('.installed-skill-card').first()).toBeVisible();
    const skillGeometry = await skills.evaluate(element => {
      const description = element.querySelector('.workspace-description')!.getBoundingClientRect();
      const filters = element.querySelector('.workspace-filterbar')!.getBoundingClientRect();
      return { descriptionY: description.y, descriptionH: description.height, filtersY: filters.y, filtersH: filters.height, dividerY: filters.bottom };
    });
    expect(skillGeometry).toEqual(taskGeometry);
    // Grid tiles stay borderless at rest: a row of card top borders ~20px under
    // the divider reads as a second, inset divider line.
    const skillGridTops = await skills.evaluate(() => {
      const grid = document.querySelector('.installed-skills-grid')!;
      const card = grid.querySelector('.installed-skill-card')!;
      return { gridMarginTop: getComputedStyle(grid).marginTop, cardBorderTop: getComputedStyle(card).borderTopColor };
    });
    expect(skillGridTops.gridMarginTop).toBe('24px');
    expect(skillGridTops.cardBorderTop).toMatch(/rgba?\([^)]*,\s*0\s*\)/);
    await page.getByRole('button', { name: locale === 'en-US' ? 'Plans' : '计划', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
    const plans = page.locator('.plans-shell');
    const planGeometry = await plans.evaluate(element => {
      const description = element.querySelector('.workspace-description')!.getBoundingClientRect();
      const filters = element.querySelector('.workspace-filterbar')!.getBoundingClientRect();
      return { descriptionY: description.y, descriptionH: description.height, filtersY: filters.y, filtersH: filters.height, dividerY: filters.bottom };
    });
    expect(planGeometry).toEqual(taskGeometry);
    expect(await plans.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    if (width === 1120) await page.screenshot({ path: testInfo.outputPath(`plans-header-${locale}-${family}.png`) });
    }
  }
  await page.evaluate(() => {
    localStorage.setItem('molibot-desktop-locale', 'en-US');
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'en-US' }));
  });
  const response = await request.get(instance.endpoint + '/api/desktop/plans?includeArchived=true&limit=200');
  const { items } = await response.json();
  const statuses = ['all', 'not_started', 'in_progress', 'needs_attention', 'finished', 'archived'];
  const filters = page.locator('.workspace-plan-filters');
  for (const [index, status] of statuses.entries()) {
    const expected = items.filter((item: { planStatus: string }) => status === 'all' || item.planStatus === status).length;
    const button = filters.getByRole('button').nth(index);
    await expect(button.locator('.workspace-category-count')).toHaveText(String(expected));
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.plans-list > li')).toHaveCount(expected);
  }
  await page.locator('.chat-header').getByRole('button', { name: 'Search plans', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search plans', exact: true }).fill('no-match-for-filter-counts');
  for (const count of await filters.locator('.workspace-category-count').all()) await expect(count).toHaveText('0');
  await expect(page.locator('.plans-list > li')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search plans', exact: true }).press('Escape');
  await filters.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
});


test('Mini App content follows its limited description column @workspace @smoke', async ({ page, request, instance }, testInfo) => {
  await post(request, instance.endpoint, '/api/desktop/miniapps/builtin', { appId: 'note' });
  await openChat(page);
  for (const [locale, family, appearance] of [['en-US', 'macos', 'light'], ['zh-CN', 'macos', 'dark'], ['zh-CN', 'brutalism', 'dark']]) {
    await page.evaluate(({ locale, family, appearance }) => {
      localStorage.setItem('molibot-desktop-locale', locale);
      document.documentElement.dataset.themeFamily = family;
      document.documentElement.dataset.resolvedAppearance = appearance;
      window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: locale }));
    }, { locale, family, appearance });
    for (const width of [2240, 1600, 1440, 1120, 860]) {
    await page.setViewportSize({ width, height: 940 });
    await page.getByRole('button', { name: locale === 'en-US' ? 'Mini Apps' : '小程序', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Note', exact: true })).toBeVisible();
    const miniApps = await page.locator('.workspace-scroll').evaluate(element => {
      return ['.workspace-description', '.miniapps-launchpad-toolbar', '.miniapps-launchpad-grid'].map(selector => {
        const box = element.querySelector(selector)!.getBoundingClientRect();
        return { x: box.x, right: box.right, width: box.width };
      });
    });
    expect(miniApps[1]).toEqual(miniApps[0]);
    expect(miniApps[2]).toEqual(miniApps[0]);
    expect(miniApps[0].width).toBeLessThanOrEqual(1240);
    if (width === 2240) {
      await page.locator('.miniapps-launchpad-grid').evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      await page.screenshot({ path: testInfo.outputPath(`miniapps-launchpad-limited-${locale}-${family}.png`) });
    }
    await page.getByRole('button', { name: locale === 'en-US' ? 'Manage Mini Apps' : '管理小程序', exact: true }).click();
    const manager = await page.locator('.miniapps-manager').boundingBox();
    expect(manager!.x).toBe(miniApps[0].x);
    expect(manager!.width).toBe(miniApps[0].width);
    expect(await page.locator('.workspace-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    if (width === 2240) await page.screenshot({ path: testInfo.outputPath(`miniapps-aligned-${locale}-${family}.png`) });
    await page.getByRole('button', { name: locale === 'en-US' ? 'Back to Launchpad' : '返回启动台', exact: true }).click();
    }
  }
});

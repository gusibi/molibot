import { lstat, mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

/**
 * The unified Skill Manager: one workspace owns discovery, installation and
 * platform rules; Settings keeps only the search configuration.
 *
 * Every assertion goes through the shared service boundary (the HTTP payload)
 * and the real filesystem under the isolated data directory, so a green run
 * means the UI changed actual state rather than only its own view model.
 */
test('skill manager discovers, installs, verifies and keeps platform rules @workspace @settings', async ({ page, request, instance }, testInfo) => {
  // WebKit reports this benign layout notification when the window is resized
  // mid-layout; the settings suite carries the same explicit, per-test allowance.
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  const manager = async () => (await (await request.get(instance.endpoint + '/api/desktop/skill-manager')).json()).summary;
  const searchConfig = async () => (await (await request.get(instance.endpoint + '/api/desktop/skills/search')).json()).search;

  const initial = await manager();
  expect(initial.device.execution).toBe('server');
  const builtin = initial.installed.find((item: { builtin?: { id: string } }) => item.builtin?.id === 'miniapp-creator');
  expect(builtin).toBeTruthy();
  expect(builtin.builtin.skillId).toBe(builtin.id);
  expect(initial.counts.global).toBeGreaterThan(0);

  const root = join(instance.dataDir, 'skills');
  const directory = join(root, 'miniapp-creator');
  const original = await readFile(join(directory, 'SKILL.md'), 'utf8');
  await rm(directory, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 940 });
  await openChat(page);
  const nav = page.getByRole('navigation', { name: 'Chat', exact: true });
  const openSkills = async () => {
    await nav.getByRole('button', { name: 'Auto tasks', exact: true }).click();
    await nav.getByRole('button', { name: 'Skills', exact: true }).click();
  };
  await openSkills();

  const views = page.getByRole('group', { name: 'Skills', exact: true });
  const sourceSelect = page.locator('.skills-source-filter .select-control-trigger');
  // The dev server hot-reloads when another editing session touches the app;
  // each segment re-asserts its view and filter so a reload cannot strand it.
  const openExternal = async () => {
    await views.getByRole('button', { name: /^Discover & install/ }).click();
    if (!(await sourceSelect.innerText()).includes('All sources')) {
      await sourceSelect.click();
      await page.getByRole('option', { name: /^All sources/ }).click();
    }
  };
  const card = page.locator('.installed-skill-card').filter({ hasText: 'miniapp-creator' });
  const detailPane = page.locator('.skills-detail');

  // A deleted bundled Skill keeps a recoverable card instead of disappearing.
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('checkbox')).toHaveCount(0);
  const installResponse = page.waitForResponse(result => result.url().endsWith('/api/desktop/skill-manager') && result.request().method() === 'POST');
  await card.getByRole('button', { name: 'Install', exact: true }).click();
  expect((await installResponse).ok()).toBe(true);
  await expect(card.getByRole('checkbox')).toBeVisible();
  await expect.poll(async () => (await manager()).installed.find((item: { builtin?: { id: string } }) => item.builtin?.id === 'miniapp-creator')?.builtin.installed).toBe(true);
  expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(original);

  const openDetail = async () => {
    await card.click();
    await expect(detailPane).toBeVisible();
  };
  const closeDetail = async () => {
    await detailPane.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(detailPane).toHaveCount(0);
  };

  // The runtime verdict is the real loader's answer, not a directory check.
  await openDetail();
  // The runtime verdict is a status icon with its explanation on hover, not a
  // card that pushes the content below the fold.
  await expect(detailPane.locator('.skills-runtime-badge')).toHaveAttribute('aria-label', /loads this Skill/);
  // The YAML header belongs to SKILL.md, so it is a table above the file body
  // rather than hidden behind a separate metadata panel.
  await expect(detailPane.locator('.skills-meta-table')).toContainText('description');
  await closeDetail();

  const edited = original + '\nLocal owner customization for the isolated UI test.\n';
  await writeFile(join(directory, 'SKILL.md'), edited);
  await openSkills();
  await expect(card.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  const updateResponse = page.waitForResponse(result => result.url().endsWith('/api/desktop/skill-manager') && result.request().method() === 'POST');
  await card.getByRole('button', { name: 'Update', exact: true }).click();
  expect((await updateResponse).ok()).toBe(true);
  await expect(card.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(original);
  const backup = (await readdir(root)).find(name => name.startsWith('miniapp-creator.backup-'));
  expect(backup).toBeTruthy();
  expect(await readFile(join(root, backup!, 'SKILL.md'), 'utf8')).toBe(edited);

  // Local folder installation: preflight shows the resolved target before any
  // write, then the installed copy is independent of the source folder.
  const localSource = join(instance.home, 'ui-local-skill');
  await mkdir(join(localSource, 'references'), { recursive: true });
  await writeFile(join(localSource, 'SKILL.md'), '---\nname: ui-local-demo\ndescription: Local folder install fixture\n---\nbody\n');
  await writeFile(join(localSource, 'references', 'notes.md'), '# Notes\nTree fixture\n');
  await page.getByRole('button', { name: 'Install Skill', exact: true }).click();
  const sheet = page.locator('.skills-install-dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Local folder', exact: true }).click();
  await sheet.getByLabel('Local folder').fill(localSource);
  await sheet.getByRole('button', { name: 'Check installation', exact: true }).click();
  await expect(sheet.getByText(join(root, 'ui-local-demo'), { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(sheet.getByText('Done', { exact: true })).toBeVisible();
  await sheet.locator('.skills-sheet-foot').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(async () => (await manager()).installed.some((item: { name: string; scope: string }) => item.name === 'ui-local-demo' && item.scope === 'global')).toBe(true);
  await expect(page.locator('.installed-skill-card').filter({ hasText: 'ui-local-demo' })).toHaveCount(1);

  // The directory listing is a real tree: folders start collapsed and reveal
  // their children, and a child file previews like any other file.
  await page.locator('.installed-skill-card').filter({ hasText: 'ui-local-demo' }).click();
  await expect(detailPane).toBeVisible();
  await expect(detailPane.getByRole('treeitem', { name: /notes\.md/ })).toHaveCount(0);
  await detailPane.getByRole('treeitem', { name: /references/ }).click();
  await detailPane.getByRole('treeitem', { name: /notes\.md/ }).click();
  await expect(detailPane.locator('.skills-detail-markdown')).toContainText('Tree fixture');
  await closeDetail();

  // Discovery: a Skill that lives in another tool appears as Discovered, and the
  // sheet installs it from the server's own preflight plan.
  const external = join(instance.home, '.claude', 'skills', 'external-demo');
  await mkdir(external, { recursive: true });
  await writeFile(join(external, 'SKILL.md'), '---\nname: external-demo\ndescription: Discovered fixture\n---\nbody\n');
  await page.getByRole('button', { name: 'Scan again', exact: true }).click();
  await openExternal();
  const discoveredCard = page.locator('.installed-skill-card').filter({ hasText: 'external-demo' });
  await expect(discoveredCard).toHaveCount(1);
  await expect(discoveredCard.getByText('Claude Code', { exact: false })).toBeVisible();
  await discoveredCard.getByRole('button', { name: 'Install into Molibot', exact: true }).click();
  await expect(sheet.getByText(join(root, 'external-demo'), { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(sheet.getByText('Done', { exact: true })).toBeVisible();
  await sheet.locator('.skills-sheet-foot').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(async () => (await manager()).installed.some((item: { name: string; method: string }) => item.name === 'external-demo' && item.method === 'copy')).toBe(true);
  // The source stays in the external tree; discovery now says it is installed.
  expect((await readFile(join(external, 'SKILL.md'), 'utf8')).includes('Discovered fixture')).toBe(true);
  await expect(discoveredCard.getByRole('img', { name: 'Installed', exact: true })).toBeVisible();

  // The external catalogue is split by platform, and the source facet filters
  // it without leaving the view.
  const sourceFilter = sourceSelect;
  await openExternal();
  await sourceFilter.click();
  await page.getByRole('option', { name: /^Claude Code/ }).click();
  await expect(page.locator('.discovered-card').filter({ hasText: 'Claude Code' })).toHaveCount(1);
  await expect(page.locator('.discovered-card').filter({ hasText: 'release-notes' })).toHaveCount(0);
  await sourceFilter.click();
  await page.getByRole('option', { name: /^All sources/ }).click();

  // Consolidation: one canonical copy in the shared ~/.agents/skills tree, a
  // link left in Codex. The shared tree is not a Molibot root, so the Skill
  // stays discovered and is flagged as living in the shared folder.
  const codexOnly = join(instance.home, '.codex', 'skills', 'codex-only');
  await mkdir(codexOnly, { recursive: true });
  await writeFile(join(codexOnly, 'SKILL.md'), '---\nname: codex-only\ndescription: Codex only fixture\n---\nbody\n');
  const sharedTree = join(instance.home, '.agents', 'skills');
  await page.getByRole('button', { name: 'Scan again', exact: true }).click();
  await openExternal();
  const codexCard = page.locator('.installed-skill-card').filter({ hasText: 'codex-only' });
  await expect(codexCard).toHaveCount(1);
  await codexCard.click();
  await expect(detailPane).toBeVisible();
  // The install action sits beside the name as the one accent-filled icon.
  await expect(detailPane.locator('.skills-install-fab')).toBeVisible();
  await detailPane.getByRole('button', { name: 'Consolidate', exact: true }).click();
  const consolidateSheet = page.locator('.skills-install-dialog');
  await consolidateSheet.getByText('View full paths', { exact: true }).click();
  await expect(consolidateSheet.getByText(codexOnly, { exact: true })).toBeVisible();
  await expect(consolidateSheet.getByText(sharedTree, { exact: true })).toBeVisible();
  await consolidateSheet.getByRole('button', { name: 'Consolidate', exact: true }).click();
  await expect(consolidateSheet.getByText('Consolidated', { exact: true })).toBeVisible();
  await consolidateSheet.locator('.skills-sheet-foot').getByRole('button', { name: 'Close', exact: true }).click();
  expect((await lstat(codexOnly)).isSymbolicLink()).toBe(true);
  expect(await readlink(codexOnly)).toBe(await realpath(join(sharedTree, 'codex-only')));
  const sharedCopy = (await manager()).discovered.find((item: { name: string }) => item.name === 'codex-only');
  expect(sharedCopy.inSharedDir).toBe(true);
  expect((await manager()).installed.some((item: { name: string }) => item.name === 'codex-only')).toBe(false);

  // A Link install keeps one shared copy: the source edit is the entry's content.
  const linkedSource = join(instance.home, '.codex', 'skills', 'linked-demo');
  await mkdir(linkedSource, { recursive: true });
  await writeFile(join(linkedSource, 'SKILL.md'), '---\nname: linked-demo\ndescription: Linked fixture\n---\nv1\n');
  await page.getByRole('button', { name: 'Scan again', exact: true }).click();
  await openExternal();
  const linkedCard = page.locator('.installed-skill-card').filter({ hasText: 'linked-demo' });
  await linkedCard.getByRole('button', { name: 'Install into Molibot', exact: true }).click();
  await sheet.getByRole('button', { name: 'Link', exact: true }).click();
  await sheet.getByRole('button', { name: 'Check installation', exact: true }).click();
  await sheet.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(sheet.getByText('Done', { exact: true })).toBeVisible();
  await sheet.locator('.skills-sheet-foot').getByRole('button', { name: 'Close', exact: true }).click();
  const linkedEntry = (await manager()).installed.find((item: { name: string }) => item.name === 'linked-demo');
  expect(linkedEntry.method).toBe('link');
  await writeFile(join(linkedSource, 'SKILL.md'), '---\nname: linked-demo\ndescription: Linked fixture\n---\nv2\n');
  await page.getByRole('button', { name: 'Scan again', exact: true }).click();
  const linkedDetail = await (await request.get(instance.endpoint + '/api/desktop/skill-manager/detail?id=' + linkedEntry.id)).json();
  expect(linkedDetail.detail.liveContent).toBe(true);
  expect(linkedDetail.detail.installation.localChanges).toBe(true);

  // Platform rules: disabling an adapter is a read-rule change, and saving it is
  // entity-level rather than a whole runtime-settings submit.
  await views.getByRole('button', { name: /^Platforms/ }).click();
  const cursorRow = page.locator('.skills-platform-row').filter({ hasText: 'Cursor' });
  await expect(cursorRow).toHaveCount(1);
  await cursorRow.locator('.ios-switch').click();
  await expect(cursorRow.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save platform settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save platform settings', exact: true }).click();
  await expect.poll(async () => (await manager()).platforms.find((platform: { id: string }) => platform.id === 'cursor')?.enabled).toBe(false);
  await expect(page.getByRole('button', { name: 'Save platform settings', exact: true })).toHaveCount(0);

  // Narrow width keeps the catalogue usable and never overflows horizontally.
  await views.getByRole('button', { name: /^Molibot/ }).click();
  await page.setViewportSize({ width: 860, height: 620 });
  expect(await page.locator('.workspace-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('skill-manager.png') });

  // Search configuration is a separate entity on the Settings page.
  const before = (await searchConfig()).localEnabled;
  await openSettings(page);
  const settings = page.locator('.settings-content');
  const settingsNav = page.locator('.settings-sidebar');
  await settingsNav.getByRole('button', { name: 'Skill Search', exact: true }).click();
  await settings.getByText('Skill search configuration', { exact: true }).click();
  const local = settings.getByRole('checkbox', { name: 'Local search', exact: true });
  await local.focus();
  await local.press('Space');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await searchConfig()).localEnabled).toBe(!before);

  await instance.restartService();
  expect((await searchConfig()).localEnabled).toBe(!before);
  expect((await manager()).platforms.find((platform: { id: string }) => platform.id === 'cursor')?.enabled).toBe(false);
  expect((await manager()).installed.some((item: { name: string }) => item.name === 'ui-local-demo')).toBe(true);

  // Chinese + dark must render from the same stored state.
  await page.evaluate(() => {
    document.documentElement.dataset.resolvedAppearance = 'dark';
    window.dispatchEvent(new StorageEvent('storage', { key: 'molibot-desktop-locale', newValue: 'zh-CN' }));
  });
  await expect(settings.getByText('技能搜索配置', { exact: true })).toBeVisible();
  await settingsNav.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('group', { name: '技能', exact: true }).getByRole('button', { name: /^Molibot/ }).click();
  await expect(page.locator('.installed-skill-card').filter({ hasText: 'ui-local-demo' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('skill-manager-zh-dark.png') });

  await rm(localSource, { recursive: true, force: true });
});

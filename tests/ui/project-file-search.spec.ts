import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { openChat } from './support/actions';

test('project search keeps results above previews for click, Enter and load errors @workspace', async ({ page, request, instance }, testInfo) => {
  const root = join(instance.home, 'search-project');
  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(join(root, 'reports', 'daily-2026-11.md'), '# Search preview fixture\n\nVisible Markdown content.\n');
  await writeFile(join(root, 'reports', 'daily-2026-11-next.md'), '# Second preview fixture\n');
  await writeFile(join(root, 'reports', 'notes.txt'), `${'Filler line\n'.repeat(650)}Needle on line 651\nLast line\n`);
  const response = await request.post(instance.endpoint + '/api/settings/projects', {
    headers: { origin: instance.endpoint }, data: { name: 'Search preview project', rootPath: root }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { project } = await response.json();
  const session = await request.post(`${instance.endpoint}/api/settings/projects/${project.id}/sessions`, {
    headers: { origin: instance.endpoint }, data: {}
  });
  expect(session.ok(), await session.text()).toBe(true);
  await instance.restartService();
  await page.setViewportSize({ width: 1440, height: 940 });
  await openChat(page);
  const projectsToggle = page.getByRole('button', { name: 'Projects', exact: true }).last();
  if (await projectsToggle.getAttribute('aria-expanded') !== 'true') await projectsToggle.click();
  const group = page.locator('.project-tree-group').filter({ has: page.getByRole('button', { name: 'Search preview project', exact: true }) });
  await group.getByRole('button', { name: 'Search preview project', exact: true }).click();
  await group.locator('.conversation-row').first().click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const panel = page.locator('.artifact-panel');
  const searchButton = panel.getByRole('button', { name: 'Search Project files', exact: true });
  const search = panel.getByRole('searchbox', { name: 'Search Project files', exact: true });
  await searchButton.click();
  await search.fill('2026-11');
  const results = panel.locator('.file-search');
  const hit = results.getByRole('button', { name: /daily-2026-11.md/ });
  await expect(hit).toBeVisible();
  let releaseTree!: () => void;
  const treeGate = new Promise<void>(resolve => { releaseTree = resolve; });
  await page.route('**/inspection/tree?path=reports', async route => {
    await treeGate;
    await route.continue();
  });
  await hit.click();
  try {
    await expect(panel.getByRole('heading', { name: 'Search preview fixture', exact: true })).toBeVisible();
  } finally {
    releaseTree();
  }
  await expect(search).toBeVisible();
  await expect(hit).toBeVisible();
  await expect(panel.getByRole('tree')).toHaveCount(0);
  const secondHit = results.getByRole('button', { name: /daily-2026-11-next.md/ });
  await secondHit.click();
  await expect(panel.getByRole('heading', { name: 'Second preview fixture', exact: true })).toBeVisible();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(panel.getByRole('heading', { name: 'Search preview fixture', exact: true })).toBeVisible();
  const listBox = await results.boundingBox();
  const viewerBox = await panel.getByRole('region', { name: 'File viewer', exact: true }).boundingBox();
  expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(viewerBox!.y);
  await page.screenshot({ path: testInfo.outputPath('search-markdown-preview.png') });

  await expect(search).toHaveValue('2026-11');
  await panel.getByRole('tab', { name: 'By content', exact: true }).click();
  await search.fill('Needle');
  await expect(results.getByRole('button', { name: /Needle on line 651/ })).toBeVisible();
  await search.press('Enter');
  const matchedLine = panel.locator('.code-lines').getByText('Needle on line 651', { exact: true });
  await expect(matchedLine).toBeVisible();
  await expect(matchedLine).toBeInViewport();
  await expect(search).toBeVisible();

  await panel.getByRole('tab', { name: 'By name', exact: true }).click();
  await search.fill('daily-2026-11');
  await expect(hit).toBeVisible();
  await unlink(join(root, 'reports', 'daily-2026-11.md'));
  await hit.click();
  await expect(panel.locator('.project-viewer [role="alert"]')).toBeVisible();
  await expect(search).toBeVisible();
  await expect(hit).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(panel.getByRole('tree', { name: 'Files', exact: true })).toBeVisible();
  await expect(panel.locator('.project-viewer [role="alert"]')).toBeVisible();

  await panel.locator('.file-panel-head').getByRole('button', { name: 'Collapse', exact: true }).click();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await group.locator('.conversation-row').first().click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await instance.restartService();
  await searchButton.click();
  await search.fill('notes.txt');
  await expect(panel.getByRole('button', { name: /notes.txt/ })).toBeVisible();
  await search.press('Enter');
  await expect(panel.getByRole('tabpanel', { name: 'notes.txt', exact: true })).toContainText('Filler line');
});

test('project chat header opens the context monitor for the selected project session @workspace', async ({ page, request, instance }, testInfo) => {
  const key = randomUUID().slice(0, 8);
  const root = join(instance.home, `context-project-${key}`);
  await mkdir(root, { recursive: true });
  const projectResponse = await request.post(instance.endpoint + '/api/settings/projects', {
    headers: { origin: instance.endpoint }, data: { name: `Context project ${key}`, rootPath: root }
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true);
  const { project } = await projectResponse.json();
  const sessionResponse = await request.post(`${instance.endpoint}/api/settings/projects/${project.id}/sessions`, {
    headers: { origin: instance.endpoint }, data: {}
  });
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true);
  const sessionBody = await sessionResponse.json();
  const sessionId = sessionBody.session.conversationId;
  const renameResponse = await request.patch(`${instance.endpoint}/api/settings/projects/${project.id}/sessions/${sessionId}`, {
    headers: { origin: instance.endpoint }, data: { title: 'Fixed context title' }
  });
  expect(renameResponse.ok(), await renameResponse.text()).toBe(true);

  await openChat(page);
  const projectsToggle = page.getByRole('button', { name: 'Projects', exact: true }).last();
  if (await projectsToggle.getAttribute('aria-expanded') !== 'true') await projectsToggle.click();
  const group = page.locator('.project-tree-group').filter({ has: page.getByRole('button', { name: `Context project ${key}`, exact: true }) });
  await group.getByRole('button', { name: `Context project ${key}`, exact: true }).click();
  await group.locator('.conversation-row').first().click();

  const trigger = page.locator('.chat-header').getByRole('button', { name: 'Context window', exact: true });
  await expect(trigger).toBeVisible();
  const sessionRefresh = page.waitForResponse(response => response.url().includes(`/api/settings/projects/${project.id}/sessions/${sessionId}`)
    && response.request().method() === 'GET');
  await trigger.click();
  expect((await sessionRefresh).ok()).toBe(true);
  const panel = page.locator('.context-window-popover');
  await expect(panel.getByRole('heading', { level: 3, name: 'Context Window' })).toBeVisible();
  await expect(panel).toContainText('Send a message — usage appears after the first reply');
  await page.screenshot({ path: testInfo.outputPath('project-context-window.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

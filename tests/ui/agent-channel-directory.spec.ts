import { test, expect } from './support/fixtures';
import { openChat, openSettings } from './support/actions';

const agents = Array.from({ length: 10 }, (_, i) => ({ id: i === 0 ? 'default' : `agent-${i}`, name: ['Momo', 'Research assistant', 'Writing studio', 'Personal coach', 'Project reviewer', 'Language tutor', 'Travel planner', 'Reading companion', 'Design partner', 'Weekend helper'][i], description: i === 0 ? 'Your everyday assistant for questions, ideas and getting things done.' : 'A focused assistant with clear responsibilities, reusable skills and dedicated working context.', enabled: i !== 8, canExecute: i !== 8, avatar: i ? `/agent-avatars/${['scifi-analyst', 'scifi-business-strategist', 'scifi-statistician', 'scifi-scout'][i % 4]}.svg` : '', permissionMode: null, modelOverrides: i % 3, modelRouting: { textModelKey: '', sttModelKey: '' } }));
const groups = ['web', 'telegram', 'feishu', 'qq', 'weixin'].map((channel, g) => ({ channel, total: g < 2 ? 5 : 4, enabled: g < 2 ? 4 : 4, instances: Array.from({ length: g < 2 ? 5 : 4 }, (_, i) => ({ id: `${channel}-${i}`, name: ['Daily companion', 'Research desk', 'Writing notes', 'Project updates', 'Weekend inbox'][i], agentId: agents[i].id, enabled: g >= 2 || i !== 4, allowedChatCount: channel === 'web' ? 0 : i + 1, allowedChatIds: [], permissionMode: null, configuredSecrets: [], fields: {}, display: null })) }));

async function directoryRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/desktop/agents', route => route.fulfill({ json: { ok: true, summary: { items: agents, counts: { total: 10, enabled: 9 }, defaultAgentId: 'default' } } }));
  await page.route('**/api/desktop/agent-templates', route => route.fulfill({ json: { ok: true, templates: [] } }));
  await page.route('**/api/desktop/channels', route => route.fulfill({ json: { ok: true, summary: { groups, counts: { totalInstances: 22, enabledInstances: 20 }, defaults: {} } } }));
  await page.route('**/api/desktop/profile-files?*', route => route.fulfill({ json: { ok: true, files: { 'AGENTS.md': '', 'IDENTITY.md': '', 'SOUL.md': '', 'SONG.md': '' } } }));
}

test('Agent directory supports search, status filtering, editing and safe menu dismissal @directory-polish', async ({ page }, info) => {
  await directoryRoutes(page);
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Agents', exact: true }).click();
  const directory = page.locator('.agent-directory');
  const rows = directory.locator('[data-agent-id]');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toBeInViewport();
  await expect(directory.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('agents-light.png') });
  const search = page.getByRole('searchbox', { name: 'Search Agent names, descriptions or IDs…', exact: true });
  await search.fill('RESEARCH');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Research assistant');
  await search.fill('no-matching-agent');
  await expect(directory.getByText('No matching results', { exact: true })).toBeVisible();
  await directory.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await directory.getByRole('group', { name: 'Filter enabled state' }).getByRole('button', { name: 'Disabled 1', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Design partner');
  await directory.getByRole('button', { name: 'All 10', exact: true }).click();
  const more = rows.first().getByRole('button', { name: 'More actions for Momo', exact: true });
  await more.click();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Momo');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(more).toBeFocused();
  await rows.nth(1).getByRole('button', { name: 'Edit settings for Research assistant', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Basic information', exact: true })).toBeVisible();
});

test('channel directory resolves Agent names and filters platforms without losing editor access @directory-polish', async ({ page, instance }, info) => {
  // WebKit cancels background chat handover requests during the isolated restart/reload.
  for (const path of ['handover', 'handover/ack']) test.info().annotations.push({ type: 'expected-page-error', description: `/molibot-api/api/desktop/${path} due to access control checks` });
  await directoryRoutes(page);
  await openChat(page);
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Channels', exact: true }).click();
  const directory = page.locator('.channel-directory');
  const rows = directory.locator('[data-channel-id]');
  await expect(rows).toHaveCount(22);
  await expect(rows.first()).toBeInViewport();
  await page.screenshot({ path: info.outputPath('channels-light.png') });
  const search = page.getByRole('searchbox', { name: 'Search instance names, linked Agents or IDs…', exact: true });
  await search.fill('Research assistant');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Linked agent: Research assistant');
  await search.fill('');
  await directory.getByRole('navigation', { name: 'Channels', exact: true }).getByRole('button', { name: 'Telegram 5', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await directory.getByRole('group', { name: 'Filter enabled state' }).getByRole('button', { name: 'Disabled 2', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Weekend inbox');
  await directory.getByRole('button', { name: 'All 22', exact: true }).click();
  await rows.first().getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.locator('.entity-editor-dialog');
  await expect(editor.getByLabel('Instance name')).toHaveValue('Daily companion');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  const more = rows.first().getByRole('button', { name: 'More actions for Daily companion', exact: true });
  await more.focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Daily companion');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(more).toBeFocused();
  await page.setViewportSize({ width: 860, height: 620 });
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  expect(await directory.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('channels-dark-narrow.png') });
  await instance.restartService();
  await page.addInitScript(() => {
    localStorage.setItem('molibot-desktop-locale', 'zh-CN');
    localStorage.setItem('molibot-desktop-appearance', 'dark');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Molibot · 在线', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '设置', exact: true });
  await nav.getByRole('button', { name: '渠道', exact: true }).click();
  await expect(rows).toHaveCount(22);
  await page.screenshot({ path: info.outputPath('channels-chinese.png') });
  await nav.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.locator('[data-agent-id]')).toHaveCount(10);
  expect(await page.locator('.agent-directory').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('agents-chinese.png') });
});

test('directory failures offer retry without automatic retry loops @directory-polish', async ({ page }) => {
  await directoryRoutes(page);
  await openChat(page);
  await openSettings(page);
  let fail = true;
  let calls = 0;
  await page.route('**/api/desktop/agents', route => {
    calls++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'Agent list unavailable' } : { ok: true, summary: { items: agents, counts: { total: 10, enabled: 9 }, defaultAgentId: 'default' } } });
  });
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByText('Agent list unavailable', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.locator('[data-agent-id]')).toHaveCount(10);
  expect(calls).toBe(2);
  fail = true;
  let channelCalls = 0;
  await page.route('**/api/desktop/channels', route => {
    channelCalls++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false, error: 'Channel list unavailable' } : { ok: true, summary: { groups, counts: { totalInstances: 22, enabledInstances: 20 }, defaults: {} } } });
  });
  await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Channels', exact: true }).click();
  await expect(page.getByText('Channel list unavailable', { exact: true })).toBeVisible();
  expect(channelCalls).toBe(1);
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.locator('[data-channel-id]')).toHaveCount(22);
  expect(channelCalls).toBe(2);
});

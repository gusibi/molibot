import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect } from "./support/fixtures";
import { openChat, openSettings } from "./support/actions";
import { buildIsolatedEnv } from "./support/instance";

test("All memories shows vector flags and Advanced contains maintenance only @memory-vector-status", async ({ page, instance }, testInfo) => {
  execFileSync(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "--input-type=module", "-e", `
    import { SettingsStore } from './src/lib/server/settings/store.ts';
    import { MoryMemoryBackend } from './src/lib/server/memory/moryCore.ts';
    const store = new SettingsStore();
    const settings = store.load();
    settings.plugins.memory.enabled = true;
    settings.plugins.memory.backend = 'mory';
    store.save(settings);
    const backend = new MoryMemoryBackend({});
    const scope = {channel:'web', externalUserId:'vector-test', ownerId:'owner'};
    await backend.add(scope, {content:'Missing vector example', namespace:'owner:owner', domain:'owner', type:'user_fact', subject:'vector_missing', reason:'user_explicit'});
    backend.configureEmbedder(async () => [0.1,0.2,0.3], 'test:v1');
    await backend.add(scope, {content:'Stored vector example', namespace:'owner:owner', domain:'owner', type:'user_fact', subject:'vector_present', reason:'user_explicit'});
  `], { cwd: resolve('.'), env: buildIsolatedEnv({home:instance.home, dataDir:instance.dataDir, port:instance.port, modelUrl:instance.model.url, forbiddenDir:resolve(instance.home,'forbidden')}), stdio:'pipe' });
  await instance.restartService();
  // Profile synthesis is independent of the persisted record flags under test.
  await page.route('**/api/desktop/memory', async route => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'profile') {
      await route.fulfill({json:{ok:true}});
    } else await route.continue();
  });
  await openChat(page);
  await openSettings(page);
  await page.getByRole('button', {name:'Memory', exact:true}).click();
  await page.getByRole('button', {name:'Advanced', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Advanced', exact:true});
  await expect(dialog.getByRole('region', {name:'Memory records',exact:true})).toHaveCount(0);
  await expect(dialog.getByText('Stored vector example', {exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name:'Backfill vectors',exact:true})).toBeVisible();
  const response = await page.request.post(instance.endpoint + '/api/desktop/memory', {data:{action:'list',allScopes:true}});
  const items = (await response.json()).items;
  expect(items.find((item: any) => item.content === 'Missing vector example').hasEmbedding).toBe(false);
  expect(items.find((item: any) => item.content === 'Stored vector example').hasEmbedding).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'All memories', exact:true}).click();
  await expect(page.getByText('Vector stored', {exact:true})).toBeVisible();
  await expect(page.getByText('No vector', {exact:true})).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', {key:'molibot-desktop-locale',newValue:'zh-CN'}));
    window.dispatchEvent(new StorageEvent('storage', {key:'molibot-desktop-appearance',newValue:'dark'}));
  });
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText('已有向量', {exact:true})).toBeVisible();
  await expect(page.getByText('未生成向量', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'高级管理',exact:true}).click();
  const zhDialog = page.getByRole('dialog', {name:'高级管理',exact:true});
  await expect(zhDialog.getByRole('region', {name:'记忆记录',exact:true})).toHaveCount(0);
  await expect(zhDialog.getByText('Stored vector example', {exact:true})).toHaveCount(0);
  await expect(zhDialog.getByRole('button', {name:'回填向量',exact:true})).toBeVisible();
  expect(await zhDialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.screenshot({path:testInfo.outputPath('vector-status-dark-zh-mobile.png')});
  await instance.restartService();
  await page.getByRole('region', {name:'记忆',exact:true}).getByRole('button', {name:'搜索',exact:true}).click();
  await expect(page.getByText('已有向量', {exact:true})).toBeVisible();
});

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./support/fixtures";
import { openChat, openSettings, composer } from "./support/actions";

test("Pi extension manager installs a local package and preserves enablement across service restart @pi-extensions", async ({ page, instance }, testInfo) => {
  // WebKit cancels the unrelated home acknowledgement on the deliberate reload.
  testInfo.annotations.push({ type: "expected-page-error", description: "/molibot-api/api/desktop/handover/ack due to access control checks." });
  const repo = join(instance.home, "ui-pi-fixture");
  mkdirSync(repo);
  writeFileSync(join(repo, "index.ts"), `export default function(pi) {
    pi.registerTool({ name: "uiPiHello", label: "UI Pi hello", description: "Local extension fixture",
      parameters: {type:"object",properties:{}},
      async execute() { return {content:[{type:"text",text:"hello"}],details:{}}; }
    });
  }`);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=UI Test", "-c", "user.email=ui@example.invalid", "commit", "-qm", "fixture"]);

  await openChat(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const manager = page.getByRole("region", { name: "Pi Extensions", exact: true });
  await expect(manager.getByText("No Pi extensions installed.", { exact: false })).toBeVisible();
  await manager.getByLabel("Package or link", { exact: true }).fill("invalid ; package");
  await manager.getByRole("button", { name: "Check source", exact: true }).click();
  await expect(manager.getByRole("alert")).toBeVisible();
  await expect(manager.getByRole("button", { name: "Install extension", exact: true })).toHaveCount(0);
  await manager.getByLabel("Package or link", { exact: true }).fill(`file://${repo}`);
  await manager.getByRole("button", { name: "Check source", exact: true }).click();
  await manager.getByRole("button", { name: "Install extension", exact: true }).click();
  const runtimeMode = manager.getByRole("button", {name:"Runtime",exact:true});
  await runtimeMode.click();
  await page.getByRole("option", {name:"Native Pi with terminal",exact:true}).click();
  await expect(runtimeMode).toHaveText("Native Pi with terminal");
  const extension = manager.getByRole("article", { name: "ui-pi-fixture", exact: true });
  await expect(extension).toBeVisible();
  await extension.locator("summary").click();
  await expect(extension.getByText("Tools: uiPiHello", { exact: true })).toBeVisible();
  // A rejected save must not leave the switch showing an unpersisted value.
  await page.route("**/api/settings/plugins/extensions", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "toggle") {
      await route.fulfill({ status: 409, json: { ok: false, error: "Fixture rejected toggle" } });
      await page.unroute("**/api/settings/plugins/extensions");
    } else await route.continue();
  });
  await extension.getByRole("checkbox", { name: "ui-pi-fixture", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(manager.getByRole("alert")).toHaveText("Fixture rejected toggle");
  await expect(extension.getByRole("checkbox", { name: "ui-pi-fixture", exact: true })).toBeChecked();
  await extension.getByRole("checkbox", { name: "ui-pi-fixture", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(extension.getByText("Disabled", { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(extension.getByText("Disabled", { exact: true })).toBeVisible();

  await instance.restartService();
  await manager.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(extension.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(runtimeMode).toHaveText("Native Pi with terminal");
  await page.reload();
  await openSettings(page);
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(manager.getByRole("article", { name: "ui-pi-fixture", exact: true })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-locale", newValue: "zh-CN" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-appearance", newValue: "dark" }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const chineseManager = page.getByRole("region", { name: "Pi 扩展", exact: true });
  await expect(chineseManager.getByRole("article", { name: "ui-pi-fixture", exact: true })).toBeVisible();
  expect(await chineseManager.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await chineseManager.screenshot({ path: testInfo.outputPath("pi-extensions-dark-zh-mobile.png") });
  await chineseManager.getByRole("button", { name: "卸载", exact: true }).click();
  await chineseManager.getByRole("button", { name: "取消", exact: true }).click();
  await expect(chineseManager.getByRole("article", { name: "ui-pi-fixture", exact: true })).toBeVisible();
  await chineseManager.getByRole("button", { name: "卸载", exact: true }).click();
  await chineseManager.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(chineseManager.getByText("尚未安装 Pi 扩展。", { exact: false })).toBeVisible();
});

test("Pi terminal renders ANSI, forwards human input, stops and reopens @pi-extensions", async ({ page }, testInfo) => {
  let active = false;
  let status = "running";
  let reviewed = false;
  const inputs: string[] = [];
  const sizes: number[][] = [];
  const frame = "\x1b[2J\x1b[H\x1b[32mNative Pi choice\x1b[0m\r\nPress Enter to continue";
  const summary = () => ({id:"terminal-fixture",sessionId:"session",runId:"run",extensionIds:["fixture"],createdAt:Date.now(),status,contextReviewed:reviewed,requiresReview:status==="stopped"&&!reviewed});
  await page.route("**/api/settings/plugins/extensions/terminal*", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      const action = request.postDataJSON();
      expect(action.id).toBe("terminal-fixture");
      if (action.action === "input") inputs.push(action.data);
      if (action.action === "resize") sizes.push([action.columns, action.rows]);
      if (action.action === "stop") status = "stopped";
      if (action.action === "review") reviewed = true;
      await route.fulfill({json:{ok:true}});
    } else {
      const url = new URL(request.url());
      if (url.searchParams.has("id")) await route.fulfill({json:{ok:true,terminal:summary(),cursor:frame.length,reset:false,output:Number(url.searchParams.get("after"))===0?frame:""}});
      else await route.fulfill({json:{ok:true,terminals:active?[summary()]:[]}});
    }
  });
  await openChat(page);
  await composer(page).fill("Draft while a background task starts");
  await composer(page).focus();
  active = true;
  await expect(page.getByRole("button",{name:"Pi Extension Terminal · ●",exact:true})).toBeVisible();
  await expect(composer(page)).toBeFocused();
  const panel = page.getByRole("dialog", {name:"Pi Extension Terminal",exact:true});
  await expect(panel).toBeHidden();
  await page.getByRole("button",{name:"Pi Extension Terminal · ●",exact:true}).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator(".xterm-accessibility-tree")).toContainText("Native Pi choice");
  const input = panel.getByRole("textbox", {name:"Pi terminal input",exact:true});
  await input.focus();
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");
  await expect.poll(() => inputs.join("")).toContain("hello\r");
  await expect.poll(() => sizes.length).toBeGreaterThan(0);
  await panel.getByRole("button", {name:"Hide panel",exact:true}).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button",{name:"Pi Extension Terminal · ●",exact:true}).click();
  await expect(panel.locator(".xterm-accessibility-tree")).toContainText("Native Pi choice");
  await panel.getByRole("button",{name:"Stop task",exact:true}).click();
  await expect(panel.getByRole("status")).toContainText("stopped");
  const before = inputs.length;
  await panel.getByRole("textbox",{name:"Pi terminal input",exact:true}).focus();
  await page.keyboard.type("ignored");
  expect(inputs.length).toBe(before);
  await panel.getByRole("button",{name:"Effects checked — allow a fresh context",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Effects checked — allow a fresh context",exact:true})).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent("storage",{key:"molibot-desktop-locale",newValue:"zh-CN"}));
    window.dispatchEvent(new StorageEvent("storage",{key:"molibot-desktop-appearance",newValue:"dark"}));
  });
  await page.setViewportSize({width:390,height:844});
  const chinese = page.getByRole("dialog",{name:"Pi 扩展终端",exact:true});
  await expect(chinese).toBeVisible();
  expect(await chinese.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await chinese.screenshot({path:testInfo.outputPath("pi-terminal-dark-zh-mobile.png")});
  active = false;
  await expect(chinese).toBeHidden();
  await expect(page.getByRole("button",{name:/Pi 扩展终端/})).toHaveCount(0);
});

test("Web extension runtime selection persists and rejected saves retain the stored mode @pi-extensions", async ({page,instance},testInfo) => {
  const endpoint = `${instance.endpoint}/api/settings/plugins/extensions`;
  const configured = await page.request.post(endpoint,{data:{action:"setMode",mode:"native"}});
  expect(configured.ok()).toBe(true);
  await page.goto(`${instance.endpoint}/settings/plugins`);
  const mode = page.getByRole("button",{name:/运行方式|Runtime/});
  await expect(mode).toContainText(/原生 Pi|Native Pi/);
  await mode.click();
  await page.getByRole("option",{name:/服务器兼容接口|Server compatibility/}).click();
  await expect(mode).toContainText(/服务器兼容接口|Server compatibility/);
  expect((await (await page.request.get(endpoint)).json()).mode).toBe("server");
  await page.route("**/api/settings/plugins/extensions",async route=>{
    if(route.request().method()==="POST"&&route.request().postDataJSON()?.action==="setMode") {
      await route.fulfill({status:409,json:{ok:false,error:"Fixture rejected mode change"}});
      await page.unroute("**/api/settings/plugins/extensions");
    } else await route.continue();
  });
  await mode.click();
  await page.getByRole("option",{name:/原生 Pi 与终端面板|Native Pi with terminal/}).click();
  await expect(page.getByRole("alert")).toContainText("Fixture rejected mode change");
  await expect(mode).toContainText(/服务器兼容接口|Server compatibility/);
  await instance.restartService();
  await page.reload();
  await expect(mode).toContainText(/服务器兼容接口|Server compatibility/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator(".channel-page").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  const extensionSettings = page.locator("section.channel-card").filter({has:mode});
  await extensionSettings.screenshot({path:testInfo.outputPath("pi-web-runtime-mobile.png")});
  await page.getByRole("combobox",{name:"语言",exact:true}).selectOption("en-US");
  await expect(mode).toContainText("Server compatibility");
  await page.getByText("Navigate Settings",{exact:true}).click();
  await page.getByRole("button",{name:"Theme",exact:true}).click();
  await page.getByText("Navigate Settings",{exact:true}).click();
  await extensionSettings.screenshot({path:testInfo.outputPath("pi-web-runtime-en-dark-mobile.png")});
});

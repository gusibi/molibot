import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let server, browser, origin;
before(async () => {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  // This preview has no service or provider. All state belongs to a fresh browser context.
  server = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: desktop, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MOLIBOT_DESKTOP_PREVIEW_TARGET: "", VITE_MOLIBOT_PREVIEW: "0" }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Logo preview did not start")), 15000);
    server.stdout.on("data", (data) => { if (String(data).includes("Local:")) { clearTimeout(timer); resolve(); } });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Logo preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill("SIGTERM"); });

async function openSettings(page) {
  await page.waitForSelector(".chat-host");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("molibot:navigate-settings", { detail: { section: "general" } })));
}

test("logo UI confirms selection, restores on reload and shows save failures in both languages and themes", { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1120, height: 760 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(origin);
  await openSettings(page);
  await expect(page.getByRole("group", { name: "App logo", exact: true }).getByRole("button")).toHaveCount(17);
  assert.ok(await page.getByRole("group", { name: "App logo", exact: true }).evaluate(
    (logo, imported) => Boolean(imported.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.getByText("Imported themes", { exact: true }).elementHandle()
  ), "theme import appears before logo selection");
  const waving = () => page.getByRole("button", { name: /^(Waving|打招呼)$/ });
  await waving().click();
  await expect(waving()).toHaveAttribute("aria-pressed", "true");
  assert.equal(await page.evaluate(() => localStorage.getItem("molibot-desktop-app-logo")), "waving");
  await expect(page.getByRole("dialog").getByRole("img", { name: /Molibot ·/ })).toHaveAttribute("src", "/logos/08-waving.webp");
  const otherWindow = await context.newPage();
  await otherWindow.goto(origin);
  await otherWindow.evaluate(() => localStorage.setItem("molibot-desktop-app-logo", "sleeping"));
  await expect(page.getByRole("button", { name: "Sleeping", exact: true })).toHaveAttribute("aria-pressed", "true");
  await waving().click();
  await otherWindow.close();
  await page.reload();
  await openSettings(page);
  await expect(waving()).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Interface language", { exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(waving()).toHaveText("打招呼");
  await page.getByRole("radio", { name: "暗", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-resolved-appearance", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await waving().scrollIntoViewIfNeeded();
  const bounds = await waving().boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "logo button stays inside the narrow viewport");

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "molibot-desktop-app-logo") throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "打盹", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/无法更新应用图标.*storage unavailable/);
  await expect(waving()).toHaveAttribute("aria-pressed", "true");
  assert.equal(await page.evaluate(() => localStorage.getItem("molibot-desktop-app-logo")), "waving");
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.getByLabel("界面语言", { exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/Could not update the app icon.*storage unavailable/);
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-resolved-appearance", "light");
  await context.close();
});

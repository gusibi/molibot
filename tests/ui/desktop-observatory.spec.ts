import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "./support/fixtures";
import { openChat, openSettings } from "./support/actions";
import { buildIsolatedEnv, type IsolatedInstance } from "./support/instance";
import { buildThemeTokens, parseVscodeTheme } from "../../apps/desktop/src/lib/theme/vscodeTheme";

function seed(instance: IsolatedInstance, moreModels = false): void {
  execFileSync(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "tests/ui/support/seed-observatory.ts", ...(moreModels ? ["--more-models"] : [])], {
    cwd: resolve("."),
    env: buildIsolatedEnv({ home: instance.home, dataDir: instance.dataDir, port: instance.port, modelUrl: instance.model.url, forbiddenDir: resolve(instance.home, "forbidden") }),
    stdio: "pipe"
  });
}

test("Desktop usage and Trace show real totals, Agent filters, errors and recovery @observatory", async ({ page, instance }, testInfo) => {
  seed(instance);
  await instance.restartService();
  await openChat(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  const overview = page.getByRole("region", { name: "Usage overview", exact: true });
  await expect(overview.getByText("2.3K", { exact: true })).toBeVisible();
  const filters = page.getByRole("group", { name: "Filter usage", exact: true });
  for (const name of ["Model", "Agent", "Channel"]) {
    const label = await filters.getByText(name, { exact: true }).boundingBox();
    const control = await filters.getByRole("button", { name, exact: true }).boundingBox();
    expect(label).not.toBeNull();
    expect(control).not.toBeNull();
    expect(Math.abs(label!.y + label!.height / 2 - control!.y - control!.height / 2), `${name} label and control must share a row`).toBeLessThanOrEqual(2);
    expect(label!.x + label!.width, `${name} label precedes its control`).toBeLessThanOrEqual(control!.x);
  }
  // Reintroduce the stacked field layout inside this isolated page to prove the geometry guard detects it.
  const modelLabel = filters.getByText("Model", { exact: true });
  await modelLabel.evaluate(element => element.closest("label")!.style.gridTemplateColumns = "minmax(0, 1fr)");
  const stackedLabel = (await modelLabel.boundingBox())!;
  const stackedControl = (await filters.getByRole("button", { name: "Model", exact: true }).boundingBox())!;
  expect(Math.abs(stackedLabel.y + stackedLabel.height / 2 - stackedControl.y - stackedControl.height / 2)).toBeGreaterThan(2);
  await modelLabel.evaluate(element => element.closest("label")!.style.removeProperty("grid-template-columns"));
  await expect(page.getByRole("region", { name: "Usage by Bot", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Usage by channel", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Usage by Agent", exact: true }).getByRole("button", { name: /UI Second/ })).toBeVisible();
  const usage = await (await page.request.get(`${instance.endpoint}/api/desktop/usage?range=today`)).json();
  expect(usage.summary.totals.totalTokens).toBe(2329);
  expect(usage.summary.records.total).toBe(20);
  await page.screenshot({ path: testInfo.outputPath("usage-macos.png"), fullPage: true });
  await page.getByRole("region", { name: "Usage by Agent", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("usage-lists.png") });
  await page.getByRole("region", { name: "Usage by Agent", exact: true }).getByRole("button", { name: /UI Second/ }).click();
  await expect(overview.getByText("685", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(overview.getByText("2.3K", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Trace", exact: true }).click();
  const results = page.getByRole("region", { name: "Model request outcomes", exact: true });
  await expect(results.getByText("85%", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Requests by Bot", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Requests by channel", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tools", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Skills", exact: true })).toBeVisible();
  expect(await page.getByText("Request details & diagnostics", { exact: true }).evaluate(element => element.closest("details")!.open)).toBe(false);
  const trace = await (await page.request.get(`${instance.endpoint}/api/desktop/trace?range=today`)).json();
  expect(trace.summary.totals.modelCalls).toBe(24);
  const performance = page.getByRole("region", { name: "Agent execution performance", exact: true });
  const trend = page.getByRole("region", { name: "Invocation trend", exact: true });
  await expect(performance.getByText("75%", { exact: true })).toBeVisible();
  await expect(performance.getByText("$0.17", { exact: true })).toBeVisible();
  await expect(performance.getByText("22.2%", { exact: true })).toBeVisible();
  // Reproduce the overflowing long, unwrapped heading, then restore the real UI.
  const detectsOldHeading = await page.locator(".analytics-agent-table").evaluate(table => {
    const cell = table.querySelectorAll("th")[2] as HTMLElement;
    const text = cell.textContent;
    cell.textContent = "Run completion success rate";
    cell.style.whiteSpace = "nowrap";
    const overflow = cell.scrollWidth > cell.clientWidth + 1;
    cell.textContent = text;
    cell.style.removeProperty("white-space");
    return overflow;
  });
  expect(detectsOldHeading).toBe(true);

  expect(trace.summary.trend).toHaveLength(24);
  expect(trace.summary.trend.reduce((sum: number, point: any) => sum + point.modelCalls, 0)).toBe(24);
  expect(trace.summary.trend.reduce((sum: number, point: any) => sum + point.toolCalls, 0)).toBe(1);
  expect(trace.summary.trend.reduce((sum: number, point: any) => sum + point.mcpCalls, 0)).toBe(1);
  await expect(trend.locator('[data-series="mcpCalls"]')).toHaveCount(1);
  await trend.getByRole("button", { name: /^MCP calls/ }).click();
  await expect(trend.locator('[data-series="mcpCalls"]')).toHaveCount(0);
  await trend.getByRole("button", { name: /^MCP calls/ }).click();
  await trend.getByRole("button", { name: /^00:00:/ }).focus();
  await expect(page.getByRole("status", { name: "Calls at time point", exact: true }).getByText("00:00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await expect(trend.getByRole("button", { name: /^\d{2}-\d{2}:/ })).toHaveCount(7);
  expect(await trend.locator(".analytics-trend-hit").evaluateAll(rects => rects.every(rect => Number(rect.getAttribute("x")) >= 0 && Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) <= 100.001))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("trace-daily.png"), fullPage: true });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(trend.getByRole("button", { name: /^00:00:/ })).toHaveCount(1);

  expect(trace.summary.totals.modelOutcomes).toEqual({ success: 17, error: 3, pending: 2, aborted: 1, blocked: 1, other: 0 });
  await page.screenshot({ path: testInfo.outputPath("trace-macos.png"), fullPage: true });
  await page.getByRole("region", { name: "Requests by Agent", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("trace-lists.png") });
  await page.getByRole("region", { name: "Requests by Agent", exact: true }).getByRole("button", { name: /UI Second/ }).click();
  await expect(results.getByText("62.5%", { exact: true })).toBeVisible();
  await expect(performance.getByText("50%", { exact: true })).toBeVisible();
  await expect(performance.getByText("$0.05", { exact: true })).toBeVisible();
  await expect(trend.getByRole("button", { name: /^Model calls/ })).toContainText("12");
  await expect(trend.getByRole("button", { name: /^Ordinary tools/ })).toContainText("0");
  await expect(trend.getByRole("button", { name: /^MCP calls/ })).toContainText("1");
  const filteredTrace = await (await page.request.get(`${instance.endpoint}/api/desktop/trace?range=today&agentId=ui-second`)).json();
  expect(filteredTrace.summary.trend.reduce((sum: number, point: any) => sum + point.modelCalls, 0)).toBe(12);
  expect(filteredTrace.summary.trend.reduce((sum: number, point: any) => sum + point.toolCalls, 0)).toBe(0);
  expect(filteredTrace.summary.trend.reduce((sum: number, point: any) => sum + point.mcpCalls, 0)).toBe(1);

  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(results.getByText("85%", { exact: true })).toBeVisible();

  // A failed refresh keeps the last verified totals visible and can recover.
  await page.route("**/api/desktop/trace?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Analytics service unavailable" }) }));
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Analytics service unavailable" })).toBeVisible();
  await expect(results.getByText("85%", { exact: true })).toBeVisible();
  await page.unroute("**/api/desktop/trace?**");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Analytics service unavailable" })).toHaveCount(0);
  await instance.stopService();
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  await expect(page.locator(".analytics-error")).toBeVisible();
  await expect(results.getByText("85%", { exact: true })).toBeVisible();
  await instance.startService();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator(".analytics-error")).toHaveCount(0);
  await expect(results.getByText("85%", { exact: true })).toBeVisible();
  seed(instance, true);
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  const models = page.getByRole("region", { name: "Usage by model", exact: true });
  await models.getByRole("button", { name: "Show all (11)", exact: true }).click();
  await expect(models.getByRole("button", { name: /Extra Model 8/ })).toBeVisible();
  const latest = await (await page.request.get(`${instance.endpoint}/api/desktop/usage?range=today`)).json();
  expect(latest.summary.totals.requests).toBe(29);
  await models.getByRole("button", { name: "Show less", exact: true }).click();
});

test("Desktop analytics layout follows every theme in both appearances and imported palettes @observatory", async ({ page, instance }, testInfo) => {
  // Each test gets a fresh context; the worker's ledger is reused without adding records.
  await openChat(page);
  await openSettings(page);
  const app = readFileSync(resolve("apps/desktop/src/App.svelte"), "utf8");
  const recipes = Object.fromEntries([...app.match(/const THEME_RECIPE_BY_FAMILY[^=]*=\s*\{([\s\S]*?)\n  \};/)![1].matchAll(/"([^"]+)": "([^"]+)"/g)].map(match => [match[1], match[2]]));
  expect(Object.keys(recipes).length).toBe(25);
  for (const section of ["Usage", "Trace"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(page.locator(".analytics-overview").first()).toBeVisible();
    for (const [family, recipe] of Object.entries(recipes)) {
      for (const appearance of ["light", "dark"]) {
        await page.evaluate(({ family, recipe, appearance }) => {
          window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-theme-family", newValue: family }));
          window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-appearance", newValue: appearance }));
        }, { family, recipe, appearance });
        await expect(page.locator("html")).toHaveAttribute("data-theme-recipe", recipe);
        const geometry = await page.locator(".analytics-dashboard").evaluate(element => {
          const dashboard = element.getBoundingClientRect();
          const panels = [...element.querySelectorAll(".analytics-overview, .analytics-ranking, .analytics-rank-button")];
          return { overflow: panels.some(panel => { const bounds = panel.getBoundingClientRect(); return bounds.right > dashboard.right + 1 || bounds.left < dashboard.left - 1; }), pattern: getComputedStyle(element.querySelector('[data-analytics-segment="cacheRead"], [data-analytics-segment="pending"]')!).backgroundImage, color: getComputedStyle(element).color, background: getComputedStyle(element.querySelector(".analytics-overview")!).backgroundColor };
        });
        expect(geometry.overflow, `${section} ${family} ${appearance}`).toBe(false);
        if (section === "Trace") {
          const overflow = await page.locator(".analytics-agent-table").evaluate(table => [...table.querySelectorAll("th, td")].some(cell => cell.scrollWidth > cell.clientWidth + 1));
          expect(overflow, `${family} ${appearance} Agent cells`).toBe(false);
        }
        expect(geometry.color).not.toBe(geometry.background);
        expect(geometry.pattern, `${section} ${family} ${appearance} semantic pattern`).not.toBe("none");
        if (["terminal", "win98", "brutalism"].includes(family) && appearance === "dark") await page.screenshot({ path: testInfo.outputPath(`${section}-${family}.png`) });
      }
    }
    await page.setViewportSize({ width: 860, height: 620 });
    await expect(page.locator(".analytics-overview").first()).toBeVisible();
    expect(await page.locator(".analytics-dashboard").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-locale", newValue: "zh-CN" })));
    await expect(page.getByRole("region", { name: section === "Usage" ? "用量概览" : "模型请求结果", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${section}-narrow-zh.png`) });
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "molibot-desktop-locale", newValue: "en" })));
    await page.setViewportSize({ width: 1120, height: 760 });
  }
  const tokens = buildThemeTokens(parseVscodeTheme(JSON.stringify({ name: "Analytics Slate", type: "dark", colors: { "editor.background": "#20252a", "editor.foreground": "#e6e9ef", "button.background": "#458d7a" } })));
  await page.evaluate(tokens => {
    const style = document.createElement("style");
    style.textContent = `:root[data-theme-family="imported-analytics"]{${Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(";")}}`;
    document.head.append(style);
    document.documentElement.dataset.themeFamily = "imported-analytics";
    delete document.documentElement.dataset.themeRecipe;
  }, tokens);
  await expect(page.locator(".analytics-overview").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("trace-imported.png") });
  expect(instance.model.requests).toHaveLength(0);
});

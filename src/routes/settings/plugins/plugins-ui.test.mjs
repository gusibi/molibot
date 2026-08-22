import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalogPage = fs.readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
const detailPage = fs.readFileSync(new URL("./[pluginId]/+page.svelte", import.meta.url), "utf8");
const memoryPage = fs.readFileSync(new URL("./memory/+page.svelte", import.meta.url), "utf8");
const dailyPage = fs.readFileSync(new URL("./daily-materials/+page.svelte", import.meta.url), "utf8");

test("plugin pages read the Svelte locale store through the store contract", () => {
  assert.doesNotMatch(catalogPage, /locale\.get\(/);
  assert.doesNotMatch(detailPage, /locale\.get\(/);
  assert.match(catalogPage, /get\(locale\)/);
  assert.match(detailPage, /get\(locale\)/);
});

test("plugin catalog keeps the two legacy built-in settings entries visible", () => {
  assert.match(catalogPage, /\/api\/settings\/plugins\/core/);
  assert.match(catalogPage, /settingsHref/);
  assert.match(memoryPage, /settings-footbar/);
  assert.match(dailyPage, /settings-footbar/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../../../styles/settings-custom.css", import.meta.url), "utf8");

test("Web Provider settings use one provider-first master/detail workspace", () => {
  assert.match(page, /class="providers-form-grid"/);
  assert.match(page, /class="providers-sidebar-list"/);
  assert.match(page, /class="providers-detail-card"/);
  assert.match(page, /class="providers-model-list"/);
  assert.match(page, /class="providers-model-row"/);
  assert.match(styles, /\.providers-form-grid\s*\{[^}]*grid-template-columns:\s*300px minmax\(0, 1fr\)/s);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.providers-form-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});

test("Web Provider models use focused discovery and single-model editor dialogs", () => {
  assert.match(page, /showModelEditor/);
  assert.match(page, /openModelEditor\(cp\.id, index\)/);
  assert.match(page, /aria-labelledby="providers-model-editor-title"/);
  assert.match(page, /pullModelSearch/);
  assert.match(page, /aria-labelledby="providers-model-discovery-title"/);
  assert.match(page, /defaultModel: previousId && current\.defaultModel === previousId \? modelId : current\.defaultModel/);
  assert.doesNotMatch(page, /bind:value=\{model\.id\}/);
  assert.doesNotMatch(page, />🙈</);
  assert.doesNotMatch(page, />👁</);
});

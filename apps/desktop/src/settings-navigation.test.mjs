import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Settings navigation is grouped on one axis: what the pages in a group configure.
 * A new section must therefore land in exactly one group, and it must have an icon,
 * or it silently disappears from the sidebar.
 */
test("every settings section is declared once and grouped exactly once", () => {
  const app = read("./App.svelte");

  const union = app.match(/type SettingsSection =([^;]+);/);
  assert.ok(union, "SettingsSection union not found");
  const declared = [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  const navIds = [...app.match(/const SETTINGS_NAV[^=]*=\s*\[([\s\S]*?)\n  \];/)[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);

  const groupsBlock = app.match(/const SETTINGS_GROUPS[^=]*=\s*\[([\s\S]*?)\n  \];/)[1];
  const groupIds = [...groupsBlock.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
  const grouped = [...groupsBlock.matchAll(/sections:\s*\[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));

  assert.equal(new Set(groupIds).size, groupIds.length, `Duplicate settings group id: ${groupIds.join(", ")}`);
  assert.deepEqual(
    [...declared].sort(),
    [...navIds].sort(),
    "Every settings section needs exactly one SETTINGS_NAV entry with an icon",
  );
  assert.deepEqual(
    [...declared].sort(),
    [...grouped].sort(),
    "Every settings section must appear in exactly one group",
  );
  for (const group of groupsBlock.split(/\},\s*\{/)) {
    assert.match(group, /sections:\s*\[\s*"/, `Empty settings group: ${group.slice(0, 40)}`);
  }
});

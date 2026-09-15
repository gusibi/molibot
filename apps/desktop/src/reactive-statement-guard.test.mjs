// Machine guard for Recurring Pitfall #2 (CLAUDE.md): in legacy Svelte a
// reactive statement like `$: x = helper();` only depends on the (hoisted,
// never-changing) function identifier, so state read inside the helper is not
// tracked — the derivation runs once and goes stale. Shipped bugs: blank first
// open, tray "Open Web"/"Restart Service" permanently disabled (2026-07-18).
// Fix pattern: inline the deps into the reactive statement, or pass them as
// explicit arguments. If a match is genuinely static (no reactive reads),
// append `// reactive-guard-ok` to the line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

const NO_ARG_REACTIVE_CALL = /\$:\s*[A-Za-z_$][\w$.]*\s*=\s*[A-Za-z_$][\w$]*\(\)/;

test("no reactive statement derives from a bare no-arg helper call", () => {
  const offenders = [];
  for (const file of svelteFiles(srcRoot)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (NO_ARG_REACTIVE_CALL.test(line) && !line.includes("reactive-guard-ok")) {
        offenders.push(`${file.slice(srcRoot.length)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Legacy \`$:\` does not track state read inside a no-arg helper; inline the deps or pass them as arguments:\n${offenders.join("\n")}`
  );
});

// Pitfall #2 corollary (shipped 2026-09-15): a component variable derived via
// legacy `$:` and mounted as a dynamic component (`<GroupIcon …/>`) compiles to
// a mutable_source + pre_effect under Svelte 5, and the mount keeps the FIRST
// component forever — prop changes update sibling bindings (aria-expanded,
// class:open) but the rendered component never swaps. Symptom: the project
// folder icon stayed "closed" after expanding. Fix: derive the component with
// runes `$derived` in a `$props()` component, which re-mounts the dynamic tag.
// Files listed here are known pre-existing offenders pending runes conversion
// (tracked in prd.md); no new ones are allowed.
const KNOWN_LEGACY_DYNAMIC_COMPONENTS = new Set([
  "lib/chat/ComposerPermissionMenu.svelte",
  "lib/chat/ProcessActivityItem.svelte"
]);

test("no legacy $: derived variable is mounted as a dynamic component", () => {
  const offenders = [];
  for (const file of svelteFiles(srcRoot)) {
    const rel = file.slice(srcRoot.length);
    if (KNOWN_LEGACY_DYNAMIC_COMPONENTS.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    const derivedNames = [...source.matchAll(/\$:\s*([A-Z][\w]*)\s*=/g)].map((match) => match[1]);
    for (const name of derivedNames) {
      if (new RegExp(`<${name}[\\s/>]`).test(source)) {
        offenders.push(`${rel}: \`${name}\` — derive with runes $derived so the dynamic component can swap`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A legacy \`$:\` derivation is mounted as a dynamic component; it will never swap after mount (pitfall #2):\n${offenders.join("\n")}`
  );
});

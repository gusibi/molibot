// Machine guard for Recurring Pitfall #2 (CLAUDE.md), the *imported runes
// store* variant — a sibling of `reactive-statement-guard.test.mjs`, which
// covers the no-arg-helper variant.
//
// A legacy `$:` compiles to `legacy_pre_effect(deps, fn)`: only `deps` is
// tracked, and Svelte runs `fn` inside `untrack` (see
// svelte/src/internal/client/reactivity/effects.js). For a runes `$state`
// object imported from another module the compiler records
// `reactive_import(() => store)` as the dep, whose signal bumps only when the
// BINDING is reassigned — never when a property changes. So
// `$: if (projectsStore.selectedSessionId) …` runs exactly once, at mount, then
// goes stale forever. Templates are safe: there the compiler emits
// `deep_read_state`.
//
// Shipped bug (2026-07-29): ProjectChat's session-file fetch, project-settings
// derivation and per-session media cache reset were all one-shot, so switching
// project sessions left image attachments rendering as filename chips.
//
// Fix pattern: project the runes store through `toStore(...)` and read
// `$projectsView.x` inside the `$:` (mirrors the `$conversationView` pattern
// for the turn controller).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

/** Dep-list source of every `legacy_pre_effect(deps, fn)` in compiled output. */
function reactiveDependencyLists(code) {
  const lists = [];
  const marker = "legacy_pre_effect(";
  for (let at = code.indexOf(marker); at >= 0; at = code.indexOf(marker, at + 1)) {
    const window = code.slice(at + marker.length, at + marker.length + 2000);
    const end = window.indexOf(", () =>");
    if (end < 0) continue;
    lists.push(window.slice(0, end));
  }
  return lists;
}

test("no reactive statement depends on an imported runes store binding", () => {
  const offenders = [];
  for (const file of svelteFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    const { js } = compile(source, { generate: "client", filename: file });
    for (const deps of reactiveDependencyLists(js.code)) {
      for (const match of deps.matchAll(/\$\$_import_(\w+)\(\)/g)) {
        offenders.push(`${file.slice(srcRoot.length)}: \`$:\` depends on imported store \`${match[1]}\``);
      }
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `A legacy \`$:\` cannot track property reads on an imported runes \`$state\` — it runs once at mount and goes stale. Read a \`toStore(...)\` projection (\`$someView.field\`) inside the reactive statement instead:\n${[...new Set(offenders)].join("\n")}`
  );
});

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

// Machine guard for the numeric typography rule (DESIGN.md Foundations):
// data numerals render with tabular figures so counts, durations, sizes, and
// table columns never shift width as values change. The default is declared
// once on `body` and inherited everywhere; a concrete `font:` shorthand resets
// font-variant-numeric, so time/input/select/td/th re-declare it in the shared
// block and prose surfaces opt out explicitly. This test fails when the shared
// block is removed or weakened, or when a new `font-variant-numeric: normal`
// opt-out appears outside the approved prose surfaces — either it is prose
// (add its selector to the allowlist here and in DESIGN.md) or it is data and
// must stay tabular.
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

// Rules allowed to turn proportional numerals back on, keyed by the shared
// block in styles.css: rendered prose (chat messages, notes, artifact
// markdown). The composer deliberately stays tabular — its token overlay
// mirrors the textarea glyph-for-glyph, so both twins must resolve the same
// figures or the pill tint drifts off the glyphs.
const PROSE_OPT_OUT_ALLOWLIST = [".markdown-body"];

function cssRules(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => {
      const brace = chunk.indexOf("{");
      return brace === -1 ? null : { selector: chunk.slice(0, brace).trim(), body: chunk.slice(brace + 1) };
    })
    .filter(Boolean);
}

function componentStyleRules(source) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].flatMap((match) => cssRules(match[1]));
}

test("shared numeric typography block is present in styles.css", () => {
  const css = readFileSync(join(srcRoot, "styles.css"), "utf8");
  const rules = cssRules(css);
  // Exact selector equality on purpose: a substring match would let
  // ".markdown-body" satisfy a check meant for "body".
  const has = (selector, value) =>
    rules.some((rule) => rule.selector.replace(/\s+/g, " ") === selector && rule.body.includes(value));

  assert.ok(has("body", "font-variant-numeric: tabular-nums"), "the tabular default must stay on body; inheritance is what keeps longhand-styled numeric UI stable");
  assert.ok(has("time, input, select, td, th", "font-variant-numeric: tabular-nums"),
    "time/input/select/td/th must re-declare tabular-nums; a concrete `font:` shorthand on those elements resets the inherited value");
  assert.ok(has(".markdown-body", "font-variant-numeric: normal"), "rendered prose opts out of tabular figures; without the opt-out every digit in chat markdown widens");
  assert.ok(has(".markdown-body th, .markdown-body td", "font-variant-numeric: tabular-nums"), "markdown tables must re-include tabular figures or the prose opt-out un-aligns their columns");
});

test("font-variant-numeric opt-outs only appear on approved prose surfaces", () => {
  const offenders = [];

  const styles = readFileSync(join(srcRoot, "styles.css"), "utf8");
  for (const rule of cssRules(styles)) {
    if (/font-variant-numeric:\s*(normal|proportional-nums)/.test(rule.body) && !PROSE_OPT_OUT_ALLOWLIST.some((prefix) => rule.selector.includes(prefix))) {
      offenders.push(`styles.css — ${rule.selector}`);
    }
  }
  for (const file of svelteFiles(srcRoot)) {
    for (const rule of componentStyleRules(readFileSync(file, "utf8"))) {
      if (/font-variant-numeric:\s*(normal|proportional-nums)/.test(rule.body)) {
        offenders.push(`${file.slice(srcRoot.length)} — ${rule.selector}`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    "a non-prose surface turned numerals proportional again: either it renders prose (extend PROSE_OPT_OUT_ALLOWLIST and document it in DESIGN.md) or it is data and must inherit the shared tabular default");
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Mini App M3 design baseline is duplicated, on purpose and by necessity.
 *
 * Each app is served from its own origin under `default-src 'self'`
 * (`httpRoute.ts`), so there is no shared stylesheet any of them could import
 * — the `--md-*` token block has to be copied into every app and into the
 * scaffolding template. A duplicated block drifts silently: nothing errors
 * when one app's `--md-primary` is a different blue, it just makes the panel
 * look like three products again, which is exactly the state this baseline
 * was introduced to fix.
 *
 * This is the machine guard for that. It compares the token *declarations*,
 * not the whole file — each app is free to add its own expressive set on top
 * (Note's Keep palette, Todo's priority colours) as long as it is expressed as
 * app-scoped variables layered over the shared block.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

const BUILTIN_IDS = ["note", "todo", "meeting-notes"] as const;

const SHEETS: ReadonlyArray<{ label: string; file: string }> = [
  ...BUILTIN_IDS.map((id) => ({
    label: `builtin/${id}`,
    file: path.join(here, "builtin", id, "ui", "styles.css")
  })),
  {
    label: "miniapp-creator template",
    file: path.join(repoRoot, "skills/miniapp-creator/template/ui/styles.css")
  }
];

/** Every `--md-*: value;` declaration in a sheet, keyed by `<selector>|<token>`. */
function baselineTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const selector of [":root", '[data-theme="dark"]']) {
    // The baseline block is the FIRST rule for each selector; later rules are
    // the app's own layer and are deliberately not compared.
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `missing a "${selector}" block`);
    const end = css.indexOf("\n}", start);
    assert.ok(end > start, `unterminated "${selector}" block`);
    for (const [, name, value] of css.slice(start, end).matchAll(/(--md-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(`${selector}|${name}`, value.trim().replace(/\s+/g, " "));
    }
  }
  return tokens;
}

describe("Mini App M3 design baseline", () => {
  const sheets = SHEETS.map((sheet) => ({ ...sheet, css: readFileSync(sheet.file, "utf8") }));
  const [reference, ...rest] = sheets.map((sheet) => ({ ...sheet, tokens: baselineTokens(sheet.css) }));

  it("declares a non-trivial token set", () => {
    assert.ok(reference.tokens.size >= 60, `expected the full baseline, got ${reference.tokens.size} tokens`);
    for (const required of [
      ":root|--md-primary",
      ":root|--md-surface",
      ":root|--md-on-surface",
      ":root|--md-font",
      ":root|--md-shape-full",
      ":root|--md-ease-emphasized",
      ":root|--md-elev-1",
      '[data-theme="dark"]|--md-primary',
      '[data-theme="dark"]|--md-surface'
    ]) {
      assert.ok(reference.tokens.has(required), `baseline is missing ${required}`);
    }
  });

  it("is identical in every built-in app and in the scaffolding template", () => {
    for (const sheet of rest) {
      assert.deepEqual(
        [...sheet.tokens.entries()].sort(),
        [...reference.tokens.entries()].sort(),
        `${sheet.label} has drifted from ${reference.label}`
      );
    }
  });

  it("keeps the [hidden] guard ahead of every element rule", () => {
    for (const sheet of sheets) {
      const guard = sheet.css.indexOf("[hidden] { display: none !important; }");
      assert.ok(guard >= 0, `${sheet.label} dropped the [hidden] guard`);
      // Any author `display` on an element beats the UA's `[hidden]{display:none}`,
      // so the guard has to win by `!important` and be present at all.
      const firstSelector = sheet.css.slice(0, guard).search(/^[.:[a-z*]/m);
      assert.equal(firstSelector, -1, `${sheet.label} has a rule ahead of the [hidden] guard`);
    }
  });

  it("styles through the tokens rather than hard-coded type sizes", () => {
    for (const sheet of sheets) {
      // Font sizes must come from the scale. Raw `font-size: 13px` is what let
      // 17 sizes and 21 line-heights drift apart in the desktop app.
      const raw = [...sheet.css.matchAll(/font-size:\s*(\d[\d.]*)(px|rem|em)/g)].map((m) => m[0]);
      assert.deepEqual(raw, [], `${sheet.label} sets a raw font-size: ${raw.join(", ")}`);
    }
  });
});

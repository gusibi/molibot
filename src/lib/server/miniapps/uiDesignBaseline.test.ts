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
 *
 * The second describe covers rules that DO apply to every app, including the
 * two Astryx-based ones whose product CSS lives in `ui-src/`: no
 * `transition: all`, a `prefers-reduced-motion` fallback, and AA contrast for
 * the shared secondary-text token. These were the failure modes the 2026-11
 * quality audit found drifting in every unguarded app at once.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

const BUILTIN_IDS = ["note", "todo", "meeting-notes", "md-preview"] as const;

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

  it("lets Todo actions float without reserving title width", () => {
    const todo = sheets.find((sheet) => sheet.label === "builtin/todo");
    assert.ok(todo, "missing the built-in Todo stylesheet");

    const actionStart = todo.css.indexOf(".item-actions {");
    const actionEnd = todo.css.indexOf("\n}", actionStart);
    assert.ok(actionStart >= 0 && actionEnd > actionStart, "missing Todo action styles");
    const actionBlock = todo.css.slice(actionStart, actionEnd);
    assert.match(actionBlock, /position:\s*absolute;/);
    assert.match(actionBlock, /pointer-events:\s*none;/);
    assert.doesNotMatch(actionBlock, /flex-shrink:\s*0;/);

    const rowStart = todo.css.indexOf(".todo-item {");
    const rowEnd = todo.css.indexOf("\n}", rowStart);
    assert.ok(rowStart >= 0 && rowEnd > rowStart, "missing Todo row styles");
    assert.match(todo.css.slice(rowStart, rowEnd), /position:\s*relative;/);

    const textStart = todo.css.indexOf(".item-text {");
    const textEnd = todo.css.indexOf("\n}", textStart);
    assert.ok(textStart >= 0 && textEnd > textStart, "missing Todo text styles");
    const textBlock = todo.css.slice(textStart, textEnd);
    assert.match(textBlock, /flex:\s*1 1 auto;/);
    assert.match(textBlock, /min-width:\s*0;/);
  });

  it("enforces thin scrollbar rules across all built-in apps and template", () => {
    for (const sheet of sheets) {
      assert.match(
        sheet.css,
        /scrollbar-width:\s*thin;/,
        `${sheet.label} is missing scrollbar-width: thin`
      );
      assert.match(
        sheet.css,
        /::-webkit-scrollbar\s*\{[^}]*width:\s*6px;/,
        `${sheet.label} is missing 6px ::-webkit-scrollbar definition`
      );
      assert.match(
        sheet.css,
        /::-webkit-scrollbar-thumb\s*\{[^}]*background-clip:\s*padding-box;/,
        `${sheet.label} is missing styled ::-webkit-scrollbar-thumb`
      );
    }
  });
});

/**
 * Product CSS of the Astryx-based apps: own token namespace, so the drift
 * checks above don't apply — but the motion/contrast rules below do. Sources
 * are the ui-src originals; the ui/ copies are build output.
 */
const PRODUCT_SHEETS: ReadonlyArray<{ label: string; file: string }> = [
  { label: "builtin/prompt-box (ui-src)", file: path.join(here, "builtin", "prompt-box", "ui-src", "styles.css") },
  { label: "builtin/mini-chat (ui-src)", file: path.join(here, "builtin", "mini-chat", "ui-src", "styles.css") }
];

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** `rgb(R G B / A%)` and `#rrggbb` — the only formats the baseline uses. */
function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const fn = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)/);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: +fn[4] / 100 };
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = hex[1];
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
      a: 1
    };
  }
  return null;
}

function compositeOver(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a))
  };
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("Mini App cross-cutting motion and contrast guard", () => {
  const allSheets = [...SHEETS, ...PRODUCT_SHEETS].map((sheet) => ({ ...sheet, css: readFileSync(sheet.file, "utf8") }));

  it("never uses `transition: all`", () => {
    for (const sheet of allSheets) {
      const hits = [...sheet.css.matchAll(/transition\s*:\s*all[\s:][^;]*;/g)].map((m) => m[0]);
      assert.deepEqual(
        hits,
        [],
        // `transition: all` animates layout-adjacent properties no state change
        // asked for; every rule must enumerate what it actually transitions.
        `${sheet.label} uses transition: all — enumerate the properties the state change touches: ${hits.join(" | ")}`
      );
    }
  });

  it("ships a prefers-reduced-motion fallback wherever motion exists", () => {
    for (const sheet of allSheets) {
      const hasMotion = sheet.css.includes("transition:") || sheet.css.includes("animation:") || sheet.css.includes("@keyframes");
      if (!hasMotion) continue;
      assert.match(
        sheet.css,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
        `${sheet.label} declares motion but no prefers-reduced-motion fallback`
      );
    }
  });

  it("keeps --md-on-surface-variant at AA (4.5:1) over --md-surface, light and dark", () => {
    for (const sheet of SHEETS) {
      const css = readFileSync(sheet.file, "utf8");
      const tokens = baselineTokens(css);
      for (const prefix of [":root", '[data-theme="dark"]']) {
        const variant = parseColor(tokens.get(`${prefix}|--md-on-surface-variant`) ?? "");
        const surface = parseColor(tokens.get(`${prefix}|--md-surface`) ?? "");
        assert.ok(variant && surface, `${sheet.label} ${prefix} is missing the tokens this guard reads`);
        // The variant carries alpha, so it is judged as composited onto the
        // surface — exactly what a browser paints for meta text.
        const ratio = contrastRatio(compositeOver(variant, surface), surface);
        assert.ok(
          ratio >= 4.5,
          `${sheet.label} ${prefix} on-surface-variant is ${ratio.toFixed(2)}:1 on surface; meta text at 11-12px needs 4.5:1`
        );
      }
    }
  });
});

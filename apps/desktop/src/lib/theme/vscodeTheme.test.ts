import assert from "node:assert/strict";
import test from "node:test";

import {
  buildThemeTokens,
  hydrateImportedTheme,
  parseVscodeTheme,
  ThemeImportError,
  toStoredImportedTheme,
  VARIANT_TOKENS
} from "./vscodeTheme";
import { IMPORTED_THEME_STYLE_ID, importedThemeCss } from "./themeStyle";

const hydrate = (raw: string, options = {}) =>
  hydrateImportedTheme(toStoredImportedTheme(raw, { idSuffix: "abc123", ...options }))!;

const DARK_THEME = JSON.stringify({
  name: "One Dark Pro",
  type: "dark",
  colors: {
    "editor.background": "#282c34",
    "editor.foreground": "#abb2bf",
    "sideBar.background": "#21252b",
    "editorWidget.background": "#2c313a",
    "panel.background": "#21252b",
    "titleBar.activeBackground": "#21252b",
    "input.background": "#1d1f23",
    "button.background": "#61afef",
    "button.foreground": "#1d1f23",
    "panel.border": "#3b4048",
    "descriptionForeground": "#7f848e",
    "terminal.ansiGreen": "#98c379",
    "terminal.ansiRed": "#e06c75",
    "terminal.ansiYellow": "#e5c07b",
    "terminal.ansiMagenta": "#c678dd",
    "terminal.ansiCyan": "#56b6c2",
    "terminal.ansiBlue": "#61afef"
  },
  tokenColors: [
    { scope: "keyword", settings: { foreground: "#c678dd" } },
    { scope: ["string"], settings: { foreground: "#98c379" } },
    { scope: "comment", settings: { foreground: "#5c6370" } }
  ]
});

test("parses a VSCode theme and infers its variant", () => {
  const theme = parseVscodeTheme(DARK_THEME);
  assert.equal(theme.name, "One Dark Pro");
  assert.equal(theme.type, "dark");
  assert.equal(theme.colors["editor.background"], "#282c34");
});

test("accepts JSONC comments and trailing commas", () => {
  const jsonc = `{
    // leading comment
    "name": "Commented",
    "type": "light",
    "colors": {
      "editor.background": "#ffffff", /* block comment */
    },
  }`;
  const theme = parseVscodeTheme(jsonc);
  assert.equal(theme.name, "Commented");
  assert.equal(theme.type, "light");
});

test("keeps commas inside strings while stripping trailing commas", () => {
  const jsonc = `{ "name": "Odd , } theme", "type": "dark", "colors": { "editor.background": "#000000", }, }`;
  const theme = parseVscodeTheme(jsonc);
  assert.equal(theme.name, "Odd , } theme");
  assert.equal(theme.colors["editor.background"], "#000000");
});

test("infers light/dark from the editor background when type is absent", () => {
  const theme = parseVscodeTheme(
    JSON.stringify({ name: "No Type", colors: { "editor.background": "#101010" } })
  );
  assert.equal(theme.type, "dark");
});

test("rejects files that are not VSCode themes", () => {
  assert.throws(
    () => parseVscodeTheme("{ not json"),
    (error: unknown) => error instanceof ThemeImportError && error.code === "json-parse"
  );
  assert.throws(
    () => parseVscodeTheme(JSON.stringify({ name: "Just a name" })),
    (error: unknown) => error instanceof ThemeImportError && error.code === "unsupported"
  );
});

test("maps the workbench palette onto the product tokens", () => {
  const tokens = buildThemeTokens(parseVscodeTheme(DARK_THEME));
  assert.equal(tokens["--panel-bg"], "#282c34");
  assert.equal(tokens["--sidebar-bg"], "#21252b");
  assert.equal(tokens["--card-bg"], "#2c313a");
  assert.equal(tokens["--mac-label"], "#abb2bf");
  assert.equal(tokens["--accent"], "#61afef");
  assert.equal(tokens["--on-accent"], "#1d1f23");
  assert.equal(tokens["--online"], "#98c379");
  assert.equal(tokens["--syntax-code-keyword"], "#c678dd");
  assert.equal(tokens["--syntax-code-string"], "#98c379");
  assert.equal(tokens["--syntax-code-comment"], "#5c6370");
});

test("emits every token a built-in family variant owns", () => {
  // A missing token would fall back to the light macOS ramp under a dark
  // imported theme, so coverage is the invariant that keeps imports coherent.
  for (const source of [DARK_THEME, JSON.stringify({ name: "Bare", type: "light", colors: {} })]) {
    const tokens = buildThemeTokens(parseVscodeTheme(source));
    for (const token of VARIANT_TOKENS) {
      assert.ok(token in tokens, `${source.slice(0, 24)}… is missing ${token}`);
    }
  }
});

test("ignores malformed color values instead of passing them through", () => {
  const tokens = buildThemeTokens(
    parseVscodeTheme(
      JSON.stringify({
        name: "Hostile",
        type: "dark",
        colors: { "editor.background": "url(javascript:alert(1)); } body {", "editor.foreground": "#fff" }
      })
    )
  );
  for (const value of Object.values(tokens)) {
    assert.ok(!value.includes("javascript:"), `unsafe value leaked: ${value}`);
    assert.ok(!value.includes("}"), `unsafe value leaked: ${value}`);
  }
});

test("injects one scoped rule carrying the variant and the token ramp", () => {
  const css = importedThemeCss(hydrate(DARK_THEME));
  assert.match(css, /^:root\[data-theme-family="imported-one-dark-pro-abc123"\]\{/);
  assert.match(css, /color-scheme:dark;/);
  assert.match(css, /--panel-bg:#282c34;/);
  assert.equal((css.match(/\}/g) ?? []).length, 1);
  assert.equal(IMPORTED_THEME_STYLE_ID, "molibot-imported-theme-style");
});

test("stores the raw file and hydrates a stable, filename-safe record", () => {
  const stored = toStoredImportedTheme(DARK_THEME, { idSuffix: "abc123", now: "2026-01-01T00:00:00.000Z" });
  assert.equal(stored.id, "one-dark-pro-abc123");
  assert.equal(stored.importedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(stored.raw, DARK_THEME);
  assert.match(stored.id, /^[a-z0-9-]+$/);

  const theme = hydrateImportedTheme(stored);
  assert.ok(theme);
  assert.equal(theme.variant, "dark");
  assert.equal(theme.source, "One Dark Pro");
  assert.equal(theme.tokens["--panel-bg"], "#282c34");
});

test("hydrating an unusable stored theme yields null instead of throwing", () => {
  assert.equal(hydrateImportedTheme({ id: "x-1", importedAt: "t", raw: "not a theme" }), null);
});

test("floors faint theme text to a readable contrast", () => {
  // Solarized Light's own foreground is ~3.6:1 on its canvas; the label must be
  // pushed to at least WCAG AA, and the header must share the canvas token so
  // the composer's scroll-edge fade stays invisible.
  const solarized = JSON.stringify({
    name: "Solarized (light)",
    type: "light",
    colors: {
      "editor.background": "#fdf6e3",
      "editor.foreground": "#657b83",
      "button.background": "#ac9d57",
      "titleBar.activeBackground": "#eee8d5"
    }
  });
  const tokens = buildThemeTokens(parseVscodeTheme(solarized));
  assert.equal(tokens["--header-bg"], tokens["--content-bg"]);
  assert.equal(tokens["--header-bg"], "#fdf6e3");
  assert.notEqual(tokens["--on-accent"], "#ffffff", "white is unreadable on the olive accent");
});

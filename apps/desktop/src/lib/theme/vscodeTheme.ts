// Imports a VSCode color theme into Molibot's flat CSS custom-property model.
//
// A VSCode theme is a flat workbench color table (`colors`) plus TextMate token
// rules (`tokenColors`); neither knows about Molibot's semantic surfaces, glass,
// elevation or geometry. This module maps the VSCode colors onto the product
// tokens and derives the rest from the base colors, so an imported theme is a
// color-only ("product tier") family: geometry stays the shared macOS system.
//
// The importer never emits a value it did not produce from `parseColor`, so a
// hostile theme file cannot inject CSS into the generated stylesheet.

import type { Rgb } from "./color";
import { darken, ensureContrast, hex, isDark, lighten, mix, parseColor, readableOn, rgba } from "./color";

export type ThemeVariant = "light" | "dark";

export interface ImportedTheme {
  id: string;
  name: string;
  variant: ThemeVariant;
  /** Original theme name from the source file, kept for provenance. */
  source: string;
  importedAt: string;
  /** CSS custom-property name to value; only the tokens the theme overrides. */
  tokens: Record<string, string>;
}

export interface TokenColorRule {
  scopes: string[];
  foreground: Rgb;
}

export interface ParsedVscodeTheme {
  name: string;
  type: ThemeVariant;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
}

export type ThemeImportErrorCode = "json-parse" | "unsupported";

export class ThemeImportError extends Error {
  readonly code: ThemeImportErrorCode;

  constructor(code: ThemeImportErrorCode, message: string) {
    super(message);
    this.name = "ThemeImportError";
    this.code = code;
  }
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const DARK_SURFACE: Rgb = { r: 30, g: 30, b: 30 };
const LIGHT_SURFACE: Rgb = { r: 255, g: 255, b: 255 };
const DARK_TEXT: Rgb = { r: 212, g: 212, b: 212 };
const LIGHT_TEXT: Rgb = { r: 31, g: 31, b: 31 };

/**
 * VSCode parses theme files as JSONC (comments and trailing commas allowed).
 * `JSON.parse` is tried first; this conservative fallback only strips comments
 * and trailing commas that appear outside string literals.
 */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsonComments(text));
  }
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        output += current;
      }
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (current === "\\") {
        output += next ?? "";
        index += 1;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    output += current;
  }
  return removeTrailingCommas(output);
}

/** Drops a comma directly before a closing brace/bracket, outside strings. */
function removeTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    if (inString) {
      output += current;
      if (current === "\\") {
        output += text[index + 1] ?? "";
        index += 1;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    output += current;
  }
  return output;
}

function normalizeScopes(scope: unknown): string[] {
  if (typeof scope === "string") {
    return scope.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  if (Array.isArray(scope)) {
    return scope.flatMap((entry) => normalizeScopes(entry));
  }
  return [];
}

function parseTokenColors(raw: unknown): TokenColorRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: TokenColorRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const settings = (entry as { settings?: unknown }).settings as
      | { foreground?: unknown }
      | undefined;
    const foreground = parseColor(settings?.foreground);
    if (!foreground) continue;
    const scopes = normalizeScopes((entry as { scope?: unknown }).scope);
    if (scopes.length === 0) continue;
    rules.push({ scopes, foreground });
  }
  return rules;
}

function inferVariant(colors: Record<string, string>): ThemeVariant {
  const background = parseColor(colors["editor.background"]);
  return background && isDark(background) ? "dark" : "light";
}

function normalizeVariant(raw: unknown, colors: Record<string, string>): ThemeVariant {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "dark" || value === "hc") return "dark";
  if (value === "light" || value === "hclight") return "light";
  return inferVariant(colors);
}

export function parseVscodeTheme(text: string): ParsedVscodeTheme {
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch {
    throw new ThemeImportError("json-parse", "The file is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ThemeImportError("unsupported", "The file is not a theme object.");
  }
  const record = raw as Record<string, unknown>;
  const rawColors = record.colors;
  const hasColors = !!rawColors && typeof rawColors === "object" && !Array.isArray(rawColors);
  const tokenColors = parseTokenColors(record.tokenColors);
  if (!hasColors && tokenColors.length === 0) {
    throw new ThemeImportError(
      "unsupported",
      "No `colors` or `tokenColors` were found, so this is not a VSCode theme."
    );
  }
  const colors: Record<string, string> = {};
  if (hasColors) {
    for (const [key, value] of Object.entries(rawColors as Record<string, unknown>)) {
      if (typeof value === "string") colors[key] = value;
    }
  }
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Imported theme";
  return { name, type: normalizeVariant(record.type, colors), colors, tokenColors };
}

function pickColor(colors: Record<string, string>, keys: string[]): Rgb | null {
  for (const key of keys) {
    const parsed = parseColor(colors[key]);
    if (parsed) return parsed;
  }
  return null;
}

function scopeMatches(ruleScope: string, query: string): boolean {
  return (
    ruleScope === query ||
    query.startsWith(`${ruleScope}.`) ||
    ruleScope.startsWith(`${query}.`)
  );
}

/** Resolves a token foreground from TextMate rules; later rules win. */
function resolveScope(rules: TokenColorRule[], queries: string[], fallback: Rgb): Rgb {
  for (const query of queries) {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      if (rules[index].scopes.some((scope) => scopeMatches(scope, query))) {
        return rules[index].foreground;
      }
    }
  }
  return fallback;
}

const SYNTAX_SCOPES: { token: string; queries: string[] }[] = [
  { token: "keyword", queries: ["keyword.control", "keyword.operator", "keyword", "storage.type", "storage.modifier", "storage"] },
  { token: "string", queries: ["string.quoted", "string.template", "string", "constant.other.symbol"] },
  { token: "title", queries: ["entity.name.function", "entity.name.type", "entity.name.class", "support.class", "entity.name.tag", "markup.heading", "entity.name"] },
  { token: "number", queries: ["constant.numeric", "constant.language", "constant.character"] },
  { token: "comment", queries: ["comment.block.documentation", "comment.block", "comment.line", "comment"] },
  { token: "variable", queries: ["variable.parameter", "variable.other.property", "variable.other", "variable"] },
  { token: "attr", queries: ["entity.other.attribute-name", "support.type.property-name", "meta.object-literal.key"] },
  { token: "built-in", queries: ["support.function", "support.type", "support.constant", "entity.name.type.class"] }
];

// Every token a family variant block owns in the built-in themes. The mapper
// must emit all of them, or a missing token would silently fall back to the
// light macOS ramp under a dark imported theme.
const VARIANT_TOKENS = [
  "--mac-window-background", "--mac-control-background", "--mac-grouped-background",
  "--mac-elevated-background", "--mac-label", "--mac-secondary-label", "--mac-tertiary-label",
  "--mac-separator", "--mac-unemphasized-selection",
  "--diff-add-line", "--diff-add-num", "--diff-add-word",
  "--diff-del-line", "--diff-del-num", "--diff-del-word", "--diff-add-label", "--diff-del-label",
  "--sidebar-material-tint",
  "--gray-100", "--gray-200", "--gray-300", "--gray-400", "--gray-500",
  "--gray-600", "--gray-700", "--gray-800", "--gray-900", "--gray-1000",
  "--gray-alpha-100", "--gray-alpha-200", "--gray-alpha-300",
  "--gray-alpha-400", "--gray-alpha-500", "--gray-alpha-600",
  "--accent", "--accent-hover", "--accent-soft", "--on-accent",
  "--blue-700", "--blue-800", "--online", "--danger", "--warning",
  "--warning-text", "--agent-city-sky", "--skill-accent", "--miniapp-accent",
  "--verify-passed-fg", "--verify-failed-fg", "--message-bubble-border",
  "--text-primary", "--label-primary", "--text-secondary", "--label-secondary", "--label-tertiary",
  "--separator", "--hairline", "--glass-border", "--glass-border-dark", "--glass-border-light",
  "--fill", "--fill-hover",
  "--panel-bg", "--sidebar-bg", "--sidebar-surface", "--sidebar-surface-hover",
  "--content-bg", "--header-bg", "--card-bg", "--surface-secondary",
  "--bubble-bg", "--composer-bg", "--footbar-bg", "--window-bg",
  "--soft-shadow", "--float-shadow", "--popover-shadow", "--glass-shadow",
  "--drawer-shadow", "--modal-scrim", "--glass-inset",
  "--control-bg", "--control-bg-hover", "--control-border", "--control-border-strong", "--control-shadow",
  "--chart-blue", "--chart-teal", "--chart-green", "--chart-purple",
  "--chart-orange", "--chart-red", "--chart-indigo", "--chart-track", "--chart-grid",
  "--code-bg", "--code-text",
  "--syntax-code-bg", "--syntax-code-gutter", "--syntax-code-border", "--syntax-code-fg",
  "--syntax-code-keyword", "--syntax-code-string", "--syntax-code-title", "--syntax-code-number",
  "--syntax-code-comment", "--syntax-code-variable", "--syntax-code-attr", "--syntax-code-built-in",
  "--wallpaper", "--panel-blur"
];
export { VARIANT_TOKENS };

export function buildThemeTokens(theme: ParsedVscodeTheme): Record<string, string> {
  const dark = theme.type === "dark";
  const colors = theme.colors;
  const tokens: Record<string, string> = {};

  const surface = pickColor(colors, ["editor.background"]) ?? (dark ? DARK_SURFACE : LIGHT_SURFACE);
  // A theme's own foreground is the right hue but not always readable — Solarized
  // Light sits near 3.6:1 — so every label is floored to WCAG AA against the canvas.
  const text = ensureContrast(
    pickColor(colors, ["editor.foreground", "foreground"]) ?? (dark ? DARK_TEXT : LIGHT_TEXT),
    surface,
    4.5
  );
  const sidebar = pickColor(colors, ["sideBar.background", "activityBar.background"]) ?? surface;
  const widget = pickColor(colors, ["editorWidget.background", "editorHoverWidget.background"]) ??
    (dark ? lighten(surface, 0.06) : lighten(surface, 0.6));
  const grouped = pickColor(colors, ["panel.background", "editorGroupHeader.tabsBackground"]) ??
    (dark ? lighten(surface, 0.1) : darken(surface, 0.04));
  const input = pickColor(colors, ["input.background"]) ?? widget;
  const separator = pickColor(colors, ["panel.border", "editorGroup.border", "sideBar.border"]);
  const accent = pickColor(colors, ["button.background", "activityBarBadge.background", "focusBorder"]) ??
    (dark ? { r: 77, g: 159, b: 255 } : { r: 0, g: 95, b: 184 });
  const accentHover = pickColor(colors, ["button.hoverBackground"]) ??
    (dark ? lighten(accent, 0.12) : darken(accent, 0.12));
  const onAccent = ensureContrast(
    pickColor(colors, ["button.foreground"]) ?? parseColor(readableOn(accent)) ?? LIGHT_SURFACE,
    accent,
    4.5
  );
  const green = pickColor(colors, ["gitDecoration.addedResourceForeground", "terminal.ansiGreen", "terminal.ansiBrightGreen"]) ??
    (dark ? { r: 63, g: 185, b: 80 } : { r: 26, g: 127, b: 55 });
  const red = pickColor(colors, ["errorForeground", "terminal.ansiRed", "terminal.ansiBrightRed"]) ??
    (dark ? { r: 248, g: 81, b: 73 } : { r: 207, g: 34, b: 46 });
  const yellow = pickColor(colors, ["editorWarning.foreground", "terminal.ansiYellow", "terminal.ansiBrightYellow"]) ??
    (dark ? { r: 210, g: 153, b: 34 } : { r: 154, g: 103, b: 0 });
  const magenta = pickColor(colors, ["terminal.ansiMagenta", "terminal.ansiBrightMagenta"]) ??
    (dark ? { r: 188, g: 140, b: 255 } : { r: 130, g: 80, b: 223 });
  const cyan = pickColor(colors, ["terminal.ansiCyan", "terminal.ansiBrightCyan"]) ??
    (dark ? { r: 57, g: 197, b: 207 } : { r: 27, g: 124, b: 131 });
  // Secondary/tertiary are derived from the already-floored primary and then
  // floored again, rather than trusting `descriptionForeground`: VSCode themes
  // routinely set that faint enough to be unreadable as product chrome.
  const secondary = ensureContrast(mix(text, surface, dark ? 0.32 : 0.4), surface, 3.2);
  const tertiary = ensureContrast(mix(text, surface, dark ? 0.55 : 0.62), surface, 2.2);
  const border = separator ?? mix(text, surface, dark ? 0.82 : 0.86);
  const hairline = rgba(text, dark ? 0.08 : 0.06);

  const set = (token: string, value: string): void => {
    tokens[token] = value;
  };

  // Surfaces and chrome.
  set("--mac-window-background", hex(surface));
  set("--panel-bg", hex(surface));
  set("--content-bg", hex(surface));
  set("--window-bg", hex(surface));
  set("--footbar-bg", hex(surface));
  set("--wallpaper", hex(surface));
  set("--sidebar-bg", hex(sidebar));
  // Every built-in family keeps the toolbar/chat canvas on the same token as the
  // content surface; the composer's scroll-edge fade blends into `--content-bg`,
  // so splitting the two would leave a visible band above the composer.
  set("--header-bg", hex(surface));
  set("--mac-control-background", hex(input));
  set("--control-bg", hex(input));
  set("--control-bg-hover", hex(dark ? lighten(widget, 0.06) : darken(widget, 0.04)));
  set("--mac-elevated-background", hex(widget));
  set("--card-bg", hex(widget));
  set("--bubble-bg", hex(widget));
  set("--composer-bg", hex(widget));
  set("--mac-grouped-background", hex(grouped));
  set("--surface-secondary", hex(grouped));
  set("--sidebar-surface", rgba(text, dark ? 0.07 : 0.045));
  set("--sidebar-surface-hover", rgba(text, dark ? 0.11 : 0.07));
  set("--fill", rgba(text, dark ? 0.07 : 0.05));
  set("--fill-hover", rgba(text, dark ? 0.11 : 0.08));
  set("--sidebar-material-tint", rgba(sidebar, dark ? 0.68 : 0.62));
  set("--panel-blur", "none");

  // Labels.
  set("--mac-label", hex(text));
  set("--label-primary", hex(text));
  set("--text-primary", hex(text));
  set("--mac-secondary-label", hex(secondary));
  set("--label-secondary", hex(secondary));
  set("--text-secondary", hex(secondary));
  set("--mac-tertiary-label", hex(tertiary));
  set("--label-tertiary", hex(tertiary));

  // Separators and controls.
  set("--mac-separator", hex(border));
  set("--separator", hex(border));
  set("--hairline", hairline);
  set("--glass-border", hex(border));
  set("--glass-border-dark", rgba(text, dark ? 0.22 : 0.14));
  set("--glass-border-light", rgba(text, dark ? 0.25 : 0.42));
  set("--mac-unemphasized-selection", hex(pickColor(colors, ["list.inactiveSelectionBackground"]) ?? mix(text, surface, 0.86)));
  set("--control-border", hex(pickColor(colors, ["input.border"]) ?? border));
  set("--control-border-strong", hex(pickColor(colors, ["focusBorder"]) ?? mix(text, surface, dark ? 0.68 : 0.7)));
  set("--control-shadow", "none");

  // Accent and status.
  set("--accent", hex(accent));
  set("--accent-hover", hex(accentHover));
  set("--accent-soft", rgba(accent, 0.15));
  set("--blue-700", hex(accent));
  set("--blue-800", hex(accentHover));
  set("--on-accent", hex(onAccent));
  set("--online", hex(green));
  set("--danger", hex(red));
  set("--warning", hex(yellow));
  set("--warning-text", hex(ensureContrast(yellow, surface, 4.5)));
  set("--verify-passed-fg", hex(ensureContrast(green, surface, 3)));
  set("--verify-failed-fg", hex(ensureContrast(red, surface, 3)));
  set("--skill-accent", hex(magenta));
  set("--miniapp-accent", hex(cyan));
  set("--agent-city-sky", dark ? "#101820" : "#eaf3f5");
  set("--message-bubble-border", hairline);

  // Elevated neutrals.
  set("--soft-shadow", `0 2px 2px ${rgba(BLACK, dark ? 0.3 : 0.07)}`);
  set("--float-shadow", `0 8px 24px -12px ${rgba(BLACK, dark ? 0.55 : 0.28)}`);
  set("--popover-shadow", `0 1px 1px ${rgba(BLACK, dark ? 0.2 : 0.04)}, 0 4px 8px -4px ${rgba(BLACK, dark ? 0.38 : 0.08)}, 0 16px 24px -8px ${rgba(BLACK, dark ? 0.48 : 0.12)}`);
  set("--glass-shadow", `0 1px 1px ${rgba(BLACK, dark ? 0.2 : 0.04)}, 0 8px 16px -4px ${rgba(BLACK, dark ? 0.38 : 0.08)}, 0 24px 32px -8px ${rgba(BLACK, dark ? 0.48 : 0.12)}`);
  set("--drawer-shadow", `-8px 0 24px -8px ${rgba(BLACK, dark ? 0.44 : 0.18)}`);
  set("--modal-scrim", rgba(BLACK, dark ? 0.5 : 0.3));
  set("--glass-inset", "0 0 #0000");

  // Gray ramp, anchored on the canvas and the text color.
  const ramp = [0, 0.1, 0.2, 0.33, 0.46, 0.58, 0.7, 0.81, 0.91, 1];
  ramp.forEach((stop, index) => set(`--gray-${(index + 1) * 100}`, hex(mix(surface, text, stop))));
  const alphaRamp = dark ? [0.06, 0.09, 0.12, 0.12, 0.24, 0.3] : [0.05, 0.08, 0.1, 0.08, 0.21, 0.24];
  alphaRamp.forEach((alpha, index) => set(`--gray-alpha-${(index + 1) * 100}`, rgba(text, alpha)));

  // Charts, from the terminal ANSI palette where the theme provides one.
  set("--chart-blue", hex(pickColor(colors, ["terminal.ansiBlue", "terminal.ansiBrightBlue"]) ?? accent));
  set("--chart-teal", hex(cyan));
  set("--chart-green", hex(green));
  set("--chart-purple", hex(magenta));
  set("--chart-orange", hex(yellow));
  set("--chart-red", hex(red));
  set("--chart-indigo", hex(pickColor(colors, ["terminal.ansiBrightBlue", "terminal.ansiBlue"]) ?? magenta));
  set("--chart-track", rgba(text, dark ? 0.12 : 0.08));
  set("--chart-grid", rgba(text, dark ? 0.09 : 0.07));

  // Code surfaces and syntax.
  const codeBackground = pickColor(colors, ["textCodeBlock.background"]) ??
    (dark ? darken(surface, 0.25) : mix(surface, text, 0.04));
  const syntaxBackground = pickColor(colors, ["editor.background"]) ?? surface;
  set("--code-bg", hex(codeBackground));
  set("--code-text", hex(ensureContrast(pickColor(colors, ["textPreformat.foreground"]) ?? text, codeBackground, 4.5)));
  set("--syntax-code-bg", hex(syntaxBackground));
  set("--syntax-code-gutter", hex(pickColor(colors, ["editorGutter.background"]) ?? grouped));
  set("--syntax-code-border", hex(pickColor(colors, ["editorGroup.border"]) ?? border));
  set("--syntax-code-fg", hex(ensureContrast(pickColor(colors, ["editor.foreground"]) ?? text, syntaxBackground, 4.5)));
  const syntaxFallback: Record<string, Rgb> = {
    keyword: dark ? { r: 198, g: 120, b: 221 } : { r: 166, g: 38, b: 164 },
    string: dark ? { r: 152, g: 195, b: 121 } : { r: 80, g: 161, b: 79 },
    title: dark ? { r: 229, g: 192, b: 123 } : { r: 193, g: 132, b: 1 },
    number: dark ? { r: 209, g: 154, b: 102 } : { r: 152, g: 104, b: 1 },
    comment: mix(text, surface, dark ? 0.5 : 0.5),
    variable: text,
    attr: dark ? { r: 209, g: 154, b: 102 } : { r: 152, g: 104, b: 1 },
    "built-in": dark ? { r: 97, g: 175, b: 239 } : { r: 64, g: 120, b: 242 }
  };
  for (const { token, queries } of SYNTAX_SCOPES) {
    set(`--syntax-code-${token}`, hex(resolveScope(theme.tokenColors, queries, syntaxFallback[token])));
  }

  // Diff, from the diff editor colors with a tuned add/remove tint fallback.
  set("--diff-add-line", hexOrAlpha(colors["diffEditor.insertedLineBackground"]) ?? rgba(green, 0.15));
  set("--diff-add-num", hexOrAlpha(colors["diffEditor.insertedTextBackground"]) ?? rgba(green, 0.3));
  set("--diff-add-word", rgba(green, 0.4));
  set("--diff-del-line", hexOrAlpha(colors["diffEditor.removedLineBackground"]) ?? rgba(red, 0.15));
  set("--diff-del-num", hexOrAlpha(colors["diffEditor.removedTextBackground"]) ?? rgba(red, 0.3));
  set("--diff-del-word", rgba(red, 0.4));
  set("--diff-add-label", hex(green));
  set("--diff-del-label", hex(red));

  return tokens;
}

/** VSCode diff backgrounds are often a translucent rgba already; keep them as-is. */
function hexOrAlpha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^rgba?\([^)]*\)$/i.test(trimmed) ? trimmed : null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "vscode-theme";
}

/** On-disk record: identity plus the untouched theme file, nothing derived. */
export interface StoredImportedTheme {
  id: string;
  importedAt: string;
  raw: string;
}

export interface CreateImportedThemeOptions {
  now?: string;
  idSuffix?: string;
}

/** Validates a picked file and wraps it for storage. Throws on a non-theme. */
export function toStoredImportedTheme(raw: string, options: CreateImportedThemeOptions = {}): StoredImportedTheme {
  const parsed = parseVscodeTheme(raw);
  const suffix = options.idSuffix ?? Math.random().toString(16).slice(2, 8);
  return {
    id: `${slugify(parsed.name)}-${suffix}`,
    importedAt: options.now ?? new Date().toISOString(),
    raw
  };
}

/** Maps a stored theme through the current mapper; `null` if it no longer parses. */
export function hydrateImportedTheme(stored: StoredImportedTheme): ImportedTheme | null {
  try {
    const parsed = parseVscodeTheme(stored.raw);
    return {
      id: stored.id,
      name: parsed.name,
      variant: parsed.type,
      source: parsed.name,
      importedAt: stored.importedAt,
      tokens: buildThemeTokens(parsed)
    };
  } catch {
    return null;
  }
}

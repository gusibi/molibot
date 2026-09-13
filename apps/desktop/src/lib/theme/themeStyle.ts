// Runtime application of an imported theme.
//
// The mapped tokens are injected as a single `:root[data-theme-family=...]`
// rule. Keeping this in one module means the generated CSS can be asserted
// without a DOM, and the stylesheet lifecycle is identical everywhere.

import type { ImportedTheme } from "./vscodeTheme";

export const IMPORTED_THEME_STYLE_ID = "molibot-imported-theme-style";

export function importedThemeCss(theme: ImportedTheme): string {
  const declarations = Object.entries(theme.tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  const fallbackLabel = theme.variant === "dark" ? "#ffffff" : "#000000";
  return (
    `:root[data-theme-family="imported-${theme.id}"]{` +
    `color-scheme:${theme.variant};` +
    `color:${theme.tokens["--mac-label"] ?? fallbackLabel};` +
    declarations +
    `}`
  );
}

export function applyImportedThemeStyle(document: Document, theme: ImportedTheme): void {
  let element = document.getElementById(IMPORTED_THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = IMPORTED_THEME_STYLE_ID;
    document.head.appendChild(element);
  }
  element.textContent = importedThemeCss(theme);
}

export function clearImportedThemeStyle(document: Document): void {
  document.getElementById(IMPORTED_THEME_STYLE_ID)?.remove();
}

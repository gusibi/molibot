// Small, dependency-free color helpers for importing external themes.
//
// VSCode themes express colors as hex (`#RRGGBB`, `#RRGGBBAA`) and occasionally
// `rgb()`/`rgba()`. The importer only ever emits colors produced by this module,
// so a malformed value from a theme file cannot break out into the injected
// stylesheet.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const RGB_PATTERN = /^rgba?\(([^)]+)\)$/i;

function clampChannel(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function fromHex(hex: string): Rgb | null {
  const digits = hex.slice(1);
  const expand = (value: string): number => parseInt(value.length === 1 ? value + value : value, 16);
  if (digits.length === 3 || digits.length === 4) {
    return { r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]) };
  }
  if (digits.length === 6 || digits.length === 8) {
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16)
    };
  }
  return null;
}

function fromRgbFunction(value: string): Rgb | null {
  const match = value.match(RGB_PATTERN);
  if (!match) return null;
  const parts = match[1].split(/[,/\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string): number =>
    part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part);
  return { r: clampChannel(channel(parts[0])), g: clampChannel(channel(parts[1])), b: clampChannel(channel(parts[2])) };
}

/** Parses a hex or rgb()/rgba() color. `null` for anything else. */
export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (HEX_PATTERN.test(trimmed)) return fromHex(trimmed);
  if (RGB_PATTERN.test(trimmed)) return fromRgbFunction(trimmed);
  return null;
}

export function hex(color: Rgb): string {
  const part = (channel: number): string => clampChannel(channel).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

export function rgba(color: Rgb, alpha: number): string {
  const bounded = Math.min(1, Math.max(0, alpha));
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${Number(bounded.toFixed(3))})`;
}

/** Linear blend: `t = 0` yields `from`, `t = 1` yields `to`. */
export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const ratio = Math.min(1, Math.max(0, t));
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export function lighten(color: Rgb, amount: number): Rgb {
  return mix(color, WHITE, amount);
}

export function darken(color: Rgb, amount: number): Rgb {
  return mix(color, BLACK, amount);
}

/** WCAG relative luminance, used to pick a readable foreground and infer theme type. */
export function relativeLuminance(color: Rgb): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function isDark(color: Rgb): boolean {
  return relativeLuminance(color) < 0.5;
}

/** WCAG contrast ratio between two colors, from 1 (identical) to 21. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Black or white, whichever has the higher contrast on `background`. */
export function readableOn(background: Rgb): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK) ? "#ffffff" : "#000000";
}

/**
 * Nudges `foreground` toward black or white until it reaches `minimum` contrast
 * against `background`, so a theme whose own text color is faint (Solarized is a
 * common offender) still produces a readable label. The hue is preserved as far
 * as the target allows; if the minimum is unreachable the closest tone is kept.
 */
export function ensureContrast(foreground: Rgb, background: Rgb, minimum: number): Rgb {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const target = isDark(background) ? WHITE : BLACK;
  let result = foreground;
  for (let step = 1; step <= 20; step += 1) {
    result = mix(foreground, target, step / 20);
    if (contrastRatio(result, background) >= minimum) return result;
  }
  return result;
}

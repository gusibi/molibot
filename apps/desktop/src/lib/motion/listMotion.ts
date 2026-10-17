import { cubicOut } from "svelte/easing";

type FlipRects = {
  from: DOMRect;
  to: DOMRect;
};

type MotionOptions = {
  disabled?: boolean;
};

function motionDisabled(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.performance === "low"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tokenDuration(node: Element, token: "--duration-fast" | "--duration-normal", disabled = false): number {
  if (disabled || motionDisabled()) return 0;
  const raw = getComputedStyle(node).getPropertyValue(token).trim();
  if (!raw) return 0;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value;
}

/**
 * Low-amplitude list entrance used only for data mutations, never for
 * keyboard/search-driven selection. Duration comes from the CSS Motion tokens
 * so the stylesheet stays the single timing source of truth.
 */
export function listIn(node: Element, options: MotionOptions = {}) {
  return {
    duration: tokenDuration(node, "--duration-fast", options.disabled),
    easing: cubicOut,
    css: (t: number) => {
      const u = 1 - t;
      return `opacity: ${t}; translate: 0 ${u * 5}px; scale: ${0.99 + t * 0.01};`;
    }
  };
}

export function listOut(node: Element, options: MotionOptions = {}) {
  return {
    duration: tokenDuration(node, "--duration-fast", options.disabled),
    easing: cubicOut,
    css: (t: number) => {
      const u = 1 - t;
      return `opacity: ${t}; translate: 0 ${u * -3}px; scale: ${0.99 + t * 0.01};`;
    }
  };
}

/**
 * FLIP retained rows after insert/remove/reorder. Uses individual translate/
 * scale properties so existing component transforms are preserved.
 */
export function listFlip(node: Element, { from, to }: FlipRects, options: MotionOptions = {}) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const dw = to.width ? from.width / to.width : 1;
  const dh = to.height ? from.height / to.height : 1;

  return {
    duration: tokenDuration(node, "--duration-normal", options.disabled),
    easing: cubicOut,
    css: (t: number) => {
      const u = 1 - t;
      const sx = 1 + (dw - 1) * u;
      const sy = 1 + (dh - 1) * u;
      return `translate: ${u * dx}px ${u * dy}px; scale: ${sx} ${sy};`;
    }
  };
}

/** Snapshot element rects before a layout change, keyed by element. */
export function captureRectMap(nodes: Iterable<Element>): Map<Element, DOMRect> {
  const map = new Map<Element, DOMRect>();
  for (const node of nodes) map.set(node, node.getBoundingClientRect());
  return map;
}

/** Svelte's `cubicOut` expressed for the Web Animations API. */
const CUBIC_OUT = "cubic-bezier(0.215, 0.61, 0.355, 1)";

/**
 * FLIP elements between two measured layouts.
 *
 * `animate:listFlip` only runs when a keyed each block reorders; this covers
 * the other case — the container's own layout changes (grid ⇄ vertical list) —
 * by transforming each element from its previous box onto its current one.
 * Transform origin is top-left so the box maps exactly onto the old rect.
 */
export function playLayoutFlip(before: Map<Element, DOMRect>): void {
  if (motionDisabled()) return;
  for (const [node, from] of before) {
    if (!(node instanceof HTMLElement) || !node.isConnected) continue;
    const to = node.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = to.width ? from.width / to.width : 1;
    const sy = to.height ? from.height / to.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    const duration = tokenDuration(node, "--duration-normal");
    if (!duration) continue;
    node.style.transformOrigin = "top left";
    node.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: "none" }
      ],
      { duration, easing: CUBIC_OUT }
    );
  }
}

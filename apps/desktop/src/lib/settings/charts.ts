// Lightweight, dependency-free chart geometry helpers shared by the Usage and
// Trace dashboards. All charts are hand-rolled SVG so the desktop bundle stays
// free of a chart library. Trend paths render in a 0 0 100 CHART_H viewBox
// stretched to the card width (non-scaling stroke keeps lines crisp); donuts
// use the classic r = 100/2π circle so stroke-dasharray values are direct
// percentages.
export const CHART_H = 44;
const CHART_PAD_TOP = 5;
const CHART_PAD_BOTTOM = 4;
export const DONUT_R = 15.915;

export interface DonutSegment { key: string; color: string; value: number; len: number; offset: number; }

/** Maps a value series to a smoothed SVG path across the 0–100 chart width. */
export function trendLinePath(values: number[], max: number): string {
  const n = values.length;
  if (n === 0) return "";
  const span = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const yFor = (v: number) => CHART_PAD_TOP + (1 - Math.min(1, max > 0 ? v / max : 0)) * span;
  if (n === 1) return `M0 ${yFor(values[0]).toFixed(2)} L100 ${yFor(values[0]).toFixed(2)}`;
  const pts: [number, number][] = values.map((v, i) => [(i / (n - 1)) * 100, yFor(v)]);
  // Catmull-Rom → cubic bezier for a gentle, non-overshooting curve.
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.16;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/** Closes a trend line into a filled area down to the chart baseline. */
export function trendAreaPath(line: string): string {
  return line ? `${line} L100 ${CHART_H} L0 ${CHART_H} Z` : "";
}

/** Y coordinate for a single value, matching trendLinePath's scale. */
export function trendY(value: number, max: number): number {
  const span = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  return CHART_PAD_TOP + (1 - Math.min(1, max > 0 ? value / max : 0)) * span;
}

/** Builds clockwise-from-top donut ring segments with percentage dash lengths. */
export function donutSegments(items: { key: string; color: string; value: number }[]): DonutSegment[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (total <= 0) return [];
  const segments: DonutSegment[] = [];
  let acc = 0;
  for (const item of items) {
    const value = Math.max(0, item.value);
    if (value === 0) continue;
    const len = (value / total) * 100;
    segments.push({ key: item.key, color: item.color, value, len, offset: 25 - acc });
    acc += len;
  }
  return segments;
}

export function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

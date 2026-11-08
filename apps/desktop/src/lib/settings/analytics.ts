import type { DesktopModelOutcomes, DesktopUsageTotals } from "@molibot/desktop-contract";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export function compactCount(value: number): string {
  return compact.format(Math.max(0, Number.isFinite(value) ? value : 0));
}

export function cacheHitRate(totals: Pick<DesktopUsageTotals, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">): number | null {
  const input = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return input > 0 ? totals.cacheReadTokens / input * 100 : null;
}

export function modelSuccessRate(outcomes: DesktopModelOutcomes): number | null {
  const completed = outcomes.success + outcomes.error;
  return completed > 0 ? outcomes.success / completed * 100 : null;
}

export function percentage(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("en", { maximumFractionDigits: 1 })}%`;
}

export function estimatedUsd(value: number | null): string {
  return value === null ? "—" : `$${value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

/** Magpie-style adaptive decimals: ≥$100 whole, ≥$1 cents, smaller to 1/100 cent. */
export function formatCostUsd(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value >= 100) return `$${Math.round(value).toLocaleString("en")}`;
  const digits = value >= 1 ? 2 : 4;
  return `$${value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

/** Exact cost for tooltips on the adaptive form. */
export function costTitle(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `$${value.toLocaleString("en", { maximumFractionDigits: 6 })}`;
}

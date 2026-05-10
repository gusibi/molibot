import { localDateKeyInTimeZone, normalizeTimeZone } from "../time.js";

type TimestampInput = string | number | Date | undefined;

function resolveTimestamp(value: TimestampInput): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const ms = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
        return new Date(ms);
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

export function resolveScratchArtifactDir(timezone: string, timestamp?: TimestampInput): string {
  const timeZone = normalizeTimeZone(timezone);
  return localDateKeyInTimeZone(resolveTimestamp(timestamp), timeZone).replaceAll("-", "/");
}

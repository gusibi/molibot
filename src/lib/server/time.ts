const SYSTEM_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function isValidTimeZone(timeZone: string): boolean {
  const normalized = String(timeZone ?? "").trim();
  if (!normalized) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: string, fallback = SYSTEM_TIME_ZONE): string {
  const normalized = String(timeZone ?? "").trim();
  if (normalized && isValidTimeZone(normalized)) return normalized;
  const fallbackZone = String(fallback ?? "").trim();
  if (fallbackZone && isValidTimeZone(fallbackZone)) return fallbackZone;
  return SYSTEM_TIME_ZONE;
}

function getDateParts(date: Date, timeZone: string): Record<string, string> {
  const normalized = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalized,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function getOffsetString(date: Date, timeZone: string): string {
  const normalized = normalizeTimeZone(timeZone);
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  if (value === "GMT" || value === "UTC") return "+00:00";
  const match = value.match(/(?:GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return "+00:00";
  const sign = match[1].startsWith("-") ? "-" : "+";
  const hours = match[1].slice(1).padStart(2, "0");
  const minutes = (match[2] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function localDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatIsoInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  const offset = getOffsetString(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

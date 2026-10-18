export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Reuses one formatter and one date conversion per timestamp within a query. */
export function dateKeys(timeZone: string): (value: string | Date) => string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dates = new Map<string, string>();
  return value => {
    const key = typeof value === "string" ? value : value.toISOString();
    let day = dates.get(key);
    if (!day) { day = formatter.format(new Date(key)); dates.set(key, day); }
    return day;
  };
}

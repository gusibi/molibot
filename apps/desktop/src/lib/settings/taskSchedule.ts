export type TaskScheduleMode = "daily" | "weekly" | "monthly" | "custom";

export interface TaskScheduleDraft {
  mode: TaskScheduleMode;
  time: string;
  weekdays: number[];
  monthDay: number;
  customCron: string;
}

const DEFAULT_TIME = "09:00";

function exactNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isInteger(result) && result >= min && result <= max ? result : null;
}

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseWeekdays(value: string): number[] | null {
  const values = value.split(",").map((item) => exactNumber(item, 0, 6));
  if (values.some((item) => item === null)) return null;
  return [...new Set(values as number[])].sort((a, b) => a - b);
}

export function parseTaskSchedule(schedule: string): TaskScheduleDraft {
  const source = schedule.trim();
  const fields = source.split(/\s+/);
  const fallback: TaskScheduleDraft = {
    mode: "custom",
    time: DEFAULT_TIME,
    weekdays: [1],
    monthDay: 1,
    customCron: source
  };
  if (fields.length !== 5) return fallback;

  const [minuteSource, hourSource, day, month, weekday] = fields;
  const minute = exactNumber(minuteSource, 0, 59);
  const hour = exactNumber(hourSource, 0, 23);
  if (minute === null || hour === null || month !== "*") return fallback;
  const time = clock(hour, minute);

  if (day === "*" && weekday === "*") {
    return { ...fallback, mode: "daily", time };
  }
  if (day === "*") {
    const weekdays = parseWeekdays(weekday);
    if (weekdays?.length) return { ...fallback, mode: "weekly", time, weekdays };
  }
  if (weekday === "*") {
    const monthDay = exactNumber(day, 1, 31);
    if (monthDay !== null) return { ...fallback, mode: "monthly", time, monthDay };
  }
  return fallback;
}

export function taskScheduleToCron(draft: TaskScheduleDraft): string {
  if (draft.mode === "custom") return draft.customCron.trim();
  const [hour = "9", minute = "0"] = draft.time.split(":");
  if (draft.mode === "daily") return `${Number(minute)} ${Number(hour)} * * *`;
  if (draft.mode === "weekly") {
    const weekdays = [...new Set(draft.weekdays)].sort((a, b) => a - b);
    return `${Number(minute)} ${Number(hour)} * * ${weekdays.join(",")}`;
  }
  return `${Number(minute)} ${Number(hour)} ${draft.monthDay} * *`;
}

export function isTaskScheduleValid(draft: TaskScheduleDraft): boolean {
  if (draft.mode === "custom") return draft.customCron.trim().split(/\s+/).length === 5;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return false;
  return draft.mode !== "weekly" || draft.weekdays.length > 0;
}

interface CronFieldRule {
  values: Set<number> | null;
  step: number;
  min: number;
  max: number;
}

interface ParsedCron {
  minute: CronFieldRule;
  hour: CronFieldRule;
  day: CronFieldRule;
  month: CronFieldRule;
  weekday: CronFieldRule;
}

function parseCronField(source: string, min: number, max: number, allowSundaySeven = false): CronFieldRule | null {
  const raw = source.trim();
  if (!raw || raw === "*") {
    return { values: null, step: 1, min, max };
  }
  if (raw.startsWith("*/")) {
    const step = exactNumber(raw.slice(2), 1, max);
    if (step === null) return null;
    return { values: null, step, min, max };
  }
  const out = new Set<number>();
  const segments = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const effectiveMax = allowSundaySeven ? 7 : max;
  for (const segment of segments) {
    if (segment.includes("-")) {
      const parts = segment.split("-");
      if (parts.length !== 2) return null;
      const start = exactNumber(parts[0], min, effectiveMax);
      const end = exactNumber(parts[1], min, effectiveMax);
      if (start === null || end === null || start > end) return null;
      for (let value = start; value <= end; value += 1) {
        out.add(allowSundaySeven && value === 7 ? 0 : value);
      }
      continue;
    }
    const value = exactNumber(segment, min, effectiveMax);
    if (value === null) return null;
    out.add(allowSundaySeven && value === 7 ? 0 : value);
  }
  return { values: out, step: 1, min, max };
}

function matchCronField(rule: CronFieldRule, value: number): boolean {
  if (rule.values) return rule.values.has(value);
  return (value - rule.min) % rule.step === 0;
}

function parseCron(schedule: string): ParsedCron | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const day = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const weekday = parseCronField(parts[4], 0, 6, true);
  if (!minute || !hour || !day || !month || !weekday) return null;
  return { minute, hour, day, month, weekday };
}

function advanceToNextMatch(parsed: ParsedCron, cursor: Date, limitMs: number): Date | null {
  while (cursor.getTime() <= limitMs) {
    if (
      !matchCronField(parsed.month, cursor.getMonth() + 1) ||
      !matchCronField(parsed.day, cursor.getDate()) ||
      !matchCronField(parsed.weekday, cursor.getDay())
    ) {
      cursor.setHours(24, 0, 0, 0);
      continue;
    }
    if (!matchCronField(parsed.hour, cursor.getHours())) {
      cursor.setMinutes(60, 0, 0);
      continue;
    }
    if (matchCronField(parsed.minute, cursor.getMinutes())) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Computes the next local-time execution Date strictly after `from` for a 5-field cron schedule.
 */
export function nextCronOccurrence(schedule: string, from: Date = new Date(), horizonDays = 366): Date | null {
  const parsed = parseCron(schedule);
  if (!parsed) return null;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limitMs = from.getTime() + Math.max(1, horizonDays) * 24 * 60 * 60 * 1000;
  return advanceToNextMatch(parsed, cursor, limitMs);
}

/**
 * Lists local-time occurrences strictly after `from` and up to `until` (inclusive).
 */
export function listCronOccurrences(schedule: string, from: Date, until: Date, maxCount = 64): Date[] {
  const parsed = parseCron(schedule);
  if (!parsed || maxCount <= 0) return [];
  const limitMs = until.getTime();
  if (limitMs <= from.getTime()) return [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const results: Date[] = [];
  while (results.length < maxCount && cursor.getTime() <= limitMs) {
    const match = advanceToNextMatch(parsed, cursor, limitMs);
    if (!match) break;
    results.push(match);
    cursor.setTime(match.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
}

/**
 * Returns a deterministic sort key (minutes from midnight, plus cadence offset)
 * so paused or recurring tasks order chronologically by their time of day.
 */
export function cronSortMinutes(schedule: string): number {
  const parsed = parseCron(schedule);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  let firstHour = 0;
  for (let h = 0; h <= 23; h += 1) {
    if (matchCronField(parsed.hour, h)) {
      firstHour = h;
      break;
    }
  }
  let firstMinute = 0;
  for (let m = 0; m <= 59; m += 1) {
    if (matchCronField(parsed.minute, m)) {
      firstMinute = m;
      break;
    }
  }
  const cadenceOffset = parsed.day.values !== null ? 20000 : parsed.weekday.values !== null ? 10000 : 0;
  return cadenceOffset + firstHour * 60 + firstMinute;
}

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

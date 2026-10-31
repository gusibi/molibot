import assert from "node:assert/strict";
import test from "node:test";
import {
  cronSortMinutes,
  isTaskScheduleValid,
  listCronOccurrences,
  nextCronOccurrence,
  parseTaskSchedule,
  taskScheduleToCron
} from "./taskSchedule";

test("parses and rebuilds common periodic schedules", () => {
  const daily = parseTaskSchedule("5 9 * * *");
  assert.equal(daily.mode, "daily");
  assert.equal(daily.time, "09:05");
  assert.equal(taskScheduleToCron(daily), "5 9 * * *");

  const weekly = parseTaskSchedule("30 18 * * 1,3,5");
  assert.equal(weekly.mode, "weekly");
  assert.deepEqual(weekly.weekdays, [1, 3, 5]);
  assert.equal(taskScheduleToCron(weekly), "30 18 * * 1,3,5");

  const monthly = parseTaskSchedule("0 8 31 * *");
  assert.equal(monthly.mode, "monthly");
  assert.equal(monthly.monthDay, 31);
  assert.equal(taskScheduleToCron(monthly), "0 8 31 * *");
});

test("keeps unsupported Cron expressions unchanged in custom mode", () => {
  for (const schedule of ["*/15 * * * *", "0 9 * 1,7 1-5", "0 9 1 * 1"]) {
    const draft = parseTaskSchedule(schedule);
    assert.equal(draft.mode, "custom");
    assert.equal(taskScheduleToCron(draft), schedule);
  }
});

test("requires a weekday and validates custom five-field schedules", () => {
  const weekly = parseTaskSchedule("0 9 * * 1");
  weekly.weekdays = [];
  assert.equal(isTaskScheduleValid(weekly), false);
  assert.equal(isTaskScheduleValid({ ...weekly, mode: "custom", customCron: "0 9 * * *" }), true);
  assert.equal(isTaskScheduleValid({ ...weekly, mode: "custom", customCron: "0 9 * *" }), false);
});

test("computes next occurrence and multi-slot occurrences across daily and weekly schedules", () => {
  const base = new Date(2026, 9, 31, 7, 15, 0, 0); // 2026-10-31 07:15 (Saturday, day=6)

  const dailyMorning = nextCronOccurrence("30 7 * * *", base);
  assert.ok(dailyMorning);
  assert.equal(dailyMorning.getHours(), 7);
  assert.equal(dailyMorning.getMinutes(), 30);
  assert.equal(dailyMorning.getDate(), 31);

  const nextDayEarly = nextCronOccurrence("0 4 * * *", base);
  assert.ok(nextDayEarly);
  assert.equal(nextDayEarly.getMonth(), 10); // Nov 1
  assert.equal(nextDayEarly.getDate(), 1);
  assert.equal(nextDayEarly.getHours(), 4);
  assert.equal(nextDayEarly.getMinutes(), 0);

  const dualSlotEnd = new Date(2026, 9, 31, 23, 59, 0, 0);
  const dualSlots = listCronOccurrences("0 8,20 * * *", base, dualSlotEnd);
  assert.equal(dualSlots.length, 2);
  assert.equal(dualSlots[0].getHours(), 8);
  assert.equal(dualSlots[1].getHours(), 20);

  const tuesdayWeekly = nextCronOccurrence("0 9 * * 2", base);
  assert.ok(tuesdayWeekly);
  assert.equal(tuesdayWeekly.getDay(), 2);
  assert.equal(tuesdayWeekly.getHours(), 9);

  assert.equal(nextCronOccurrence("invalid cron", base), null);
  assert.ok(cronSortMinutes("4 0 * * *") < cronSortMinutes("30 7 * * *"));
  assert.ok(cronSortMinutes("30 7 * * *") < cronSortMinutes("0 9 * * 2"));
});

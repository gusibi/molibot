import assert from "node:assert/strict";
import test from "node:test";
import { isTaskScheduleValid, parseTaskSchedule, taskScheduleToCron } from "./taskSchedule";

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

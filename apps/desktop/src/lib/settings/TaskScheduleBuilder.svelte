<script lang="ts">
  import { session } from "../stores/session.svelte";
  import { isTaskScheduleValid, parseTaskSchedule, taskScheduleToCron, type TaskScheduleMode } from "./taskSchedule";

  let { schedule = $bindable() }: { schedule: string } = $props();
  let draft = $state(parseTaskSchedule(schedule));

  const modes: TaskScheduleMode[] = ["daily", "weekly", "monthly", "custom"];
  const weekdays = $derived([
    session.text.tasksWeekdayMonday,
    session.text.tasksWeekdayTuesday,
    session.text.tasksWeekdayWednesday,
    session.text.tasksWeekdayThursday,
    session.text.tasksWeekdayFriday,
    session.text.tasksWeekdaySaturday,
    session.text.tasksWeekdaySunday
  ]);

  function commit(): void {
    schedule = taskScheduleToCron(draft);
  }

  function selectMode(mode: TaskScheduleMode): void {
    draft.mode = mode;
    commit();
  }

  function toggleWeekday(day: number): void {
    draft.weekdays = draft.weekdays.includes(day)
      ? draft.weekdays.filter((item) => item !== day)
      : [...draft.weekdays, day].sort((a, b) => a - b);
    commit();
  }

  function modeLabel(mode: TaskScheduleMode): string {
    return session.text[`tasksScheduleMode_${mode}`];
  }
</script>

<fieldset class="task-schedule-builder">
  <legend>{session.text.tasksFrequency}</legend>
  <div class="task-schedule-tabs" role="group" aria-label={session.text.tasksFrequency}>
    {#each modes as mode}
      <button type="button" class:active={draft.mode === mode} aria-pressed={draft.mode === mode} onclick={() => selectMode(mode)}>{modeLabel(mode)}</button>
    {/each}
  </div>

  <div class="task-schedule-controls">
    {#if draft.mode === "weekly"}
      <div class="task-schedule-weekdays">
        <span>{session.text.tasksWeekdays}</span>
        <div role="group" aria-label={session.text.tasksWeekdays}>
          {#each weekdays as label, index}
            {@const day = index + 1}
            <button type="button" class:active={draft.weekdays.includes(day)} aria-pressed={draft.weekdays.includes(day)} onclick={() => toggleWeekday(day)}>{label}</button>
          {/each}
        </div>
        {#if draft.weekdays.length === 0}<small class="task-schedule-error">{session.text.tasksWeekdaysRequired}</small>{/if}
      </div>
    {:else if draft.mode === "monthly"}
      <label class="settings-field">
        <span>{session.text.tasksMonthDay}</span>
        <select bind:value={draft.monthDay} onchange={commit}>
          {#each Array.from({ length: 31 }, (_, index) => index + 1) as day}
            <option value={day}>{session.text.tasksMonthDayOption.replace("{day}", String(day))}</option>
          {/each}
        </select>
        {#if draft.monthDay > 28}<small>{session.text.tasksMonthDayHint}</small>{/if}
      </label>
    {/if}

    {#if draft.mode === "custom"}
      <label class="settings-field settings-field-wide">
        <span>{session.text.tasksCustomCron}</span>
        <input bind:value={draft.customCron} oninput={commit} placeholder="0 9 * * *" spellcheck="false" />
        <small>{session.text.tasksCustomCronHint}</small>
        {#if !isTaskScheduleValid(draft)}<small class="task-schedule-error">{session.text.tasksCustomCronError}</small>{/if}
      </label>
    {:else}
      <label class="settings-field">
        <span>{session.text.tasksRunTime}</span>
        <input type="time" bind:value={draft.time} onchange={commit} />
      </label>
    {/if}
  </div>

  <div class="task-schedule-result" aria-live="polite">
    <i class="ph ph-clock" aria-hidden="true"></i>
    <span>{session.text.tasksGeneratedCron}</span>
    <code>{schedule}</code>
  </div>
</fieldset>

<script lang="ts">
  import { tick } from "svelte";
  import type { DesktopUsageActivity, DesktopUsageScenario } from "@molibot/desktop-contract";
  import { session } from "../stores/session.svelte";
  import { formatTokenCount } from "../api";
  import { compactCount } from "./analytics";
  import AnalyticsRanking from "./AnalyticsRanking.svelte";

  let { activity, agentNames }: { activity: DesktopUsageActivity; agentNames: { id: string; label: string }[] } = $props();
  let metric = $state<"requests" | "totalTokens">("requests");
  let dimension = $state<"scenarios" | "agents" | "channels">("scenarios");
  let selectedDate = $state("");
  const selected = $derived(activity.days.find(day => day.date === selectedDate) ?? activity.days.at(-1));
  const max = $derived(Math.max(1, ...activity.days.map(day => day[metric])));
  const offset = $derived(new Date(`${activity.startDate}T00:00:00Z`).getUTCDay());
  const columns = $derived(Math.ceil((offset + activity.days.length) / 7));
  const monthLabels = $derived.by(() => {
    const format = new Intl.DateTimeFormat(session.locale, { month: "short", timeZone: "UTC" });
    return activity.days.flatMap((day, i) => {
      if (!day.date.endsWith("-01") && i !== 0) return [];
      const column = Math.floor((offset + i) / 7) + 1;
      // A clipped first month must not collide with the next month's label.
      if (i === 0 && Number(day.date.slice(-2)) > 20) return [];
      return [{ label: format.format(new Date(`${day.date}T00:00:00Z`)), column }];
    });
  });
  const scenarioLabels = $derived<Record<DesktopUsageScenario, string>>({
    conversation: session.text.usageActivityConversation, project: session.text.usageActivityProject,
    miniapp: session.text.usageActivityMiniapp, image: session.text.usageActivityImage,
    transcription: session.text.usageActivityTranscription, other: session.text.usageActivityOther
  });
  const dimensions = $derived([{ id: "scenarios" as const, label: session.text.usageActivityType }, { id: "agents" as const, label: session.text.analyticsAgent }, { id: "channels" as const, label: session.text.usageChannel }]);
  const rows = $derived(activity[dimension].map(row => ({ id: row.id, label: dimension === "scenarios" ? scenarioLabels[row.id as DesktopUsageScenario] : dimension === "agents" ? (row.id === "unknown" ? session.text.analyticsUnattributed : agentNames.find(agent => agent.id === row.id)?.label ?? row.id) : row.id, secondary: `${compactCount(row.totalTokens)} ${session.text.usageTokens}`, value: row.requests })));
  function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);
  }
  const weekdayFormat = $derived(new Intl.DateTimeFormat(session.locale, { weekday: "short", timeZone: "UTC" }));
  function label(day: DesktopUsageActivity["days"][number]): string {
    return fill(session.text.usageActivityDaySummary, { date: `${day.date} ${weekdayFormat.format(new Date(`${day.date}T00:00:00Z`))}`, requests: formatTokenCount(day.requests), tokens: formatTokenCount(day.totalTokens) });
  }
  async function navigate(event: KeyboardEvent, index: number): Promise<void> {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -index, End: activity.days.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(activity.days.length - 1, index + step));
    selectedDate = activity.days[target].date;
    const grid = (event.currentTarget as HTMLElement).closest('.usage-activity-grid');
    await tick();
    grid?.querySelector<HTMLButtonElement>(`[data-activity-day="${selectedDate}"]`)?.focus();
  }
</script>

<section class="settings-card usage-activity" aria-label={session.text.usageActivity}>
  <header class="analytics-panel-head"><strong>{session.text.usageActivity}</strong><div class="memory-center-tabs usage-activity-metrics" role="group" aria-label={session.text.usageActivity}>
    <button type="button" class:active={metric === "requests"} aria-pressed={metric === "requests"} onclick={() => metric = "requests"}>{session.text.usageActivityFrequency}</button>
    <button type="button" class:active={metric === "totalTokens"} aria-pressed={metric === "totalTokens"} onclick={() => metric = "totalTokens"}>{session.text.usageTokens}</button>
  </div></header>
  <p class="usage-activity-scope">{session.text.usageActivityScope}</p>
  <dl class="usage-activity-stats">
    <div><dt>{session.text.usageActivityRecorded}</dt><dd title={formatTokenCount(activity.recordedTokens)}>{compactCount(activity.recordedTokens)}</dd></div>
    <div><dt>{session.text.usageActivityPeak}</dt><dd title={activity.peakDate ?? undefined}>{compactCount(activity.peakDailyTokens)}</dd></div>
    <div><dt>{session.text.usageActivityActiveDays}</dt><dd>{activity.activeDays}</dd></div>
    <div><dt>{session.text.usageActivityCurrentStreak}</dt><dd title={session.text.usageActivityStreakHint}>{activity.currentStreak}</dd></div>
    <div><dt>{session.text.usageActivityLongestStreak}</dt><dd>{activity.longestStreak}</dd></div>
  </dl>
  <div class="usage-activity-calendar-scroll">
    <div class="usage-activity-calendar" style={`--activity-columns:${columns}`}>
      <div class="usage-activity-months" aria-hidden="true">{#each monthLabels as month}<span style={`grid-column:${month.column}`}>{month.label}</span>{/each}</div>
      <div class="usage-activity-grid" role="group" aria-label={session.text.usageActivityKeyboard}>
        {#each Array(offset) as _}<span class="usage-activity-padding" aria-hidden="true"></span>{/each}
        {#each activity.days as day, index (day.date)}
          <button type="button" class="usage-activity-day" data-activity-day={day.date} data-level={day[metric] > 0 ? Math.max(1, Math.ceil(day[metric] / max * 4)) : 0} aria-label={label(day)} title={label(day)} aria-pressed={selected?.date === day.date} tabindex={selected?.date === day.date ? 0 : -1} onclick={() => selectedDate = day.date} onfocus={() => selectedDate = day.date} onkeydown={event => void navigate(event, index)}></button>
        {/each}
      </div>
    </div>
  </div>
  <div class="usage-activity-calendar-footer">
    <p role="status">{selected ? label(selected) : session.text.usageActivityNoRecords}</p>
    <div class="usage-activity-legend" aria-label={`${session.text.usageActivityLess} → ${session.text.usageActivityMore}`}><span>{session.text.usageActivityLess}</span>{#each [0, 1, 2, 3, 4] as level}<i data-level={level} aria-hidden="true"></i>{/each}<span>{session.text.usageActivityMore}</span></div>
  </div>
  <p class="analytics-caption">{fill(session.text.usageActivityAverage, { requests: formatTokenCount(activity.requests), average: activity.averageRequestsPerActiveDay.toLocaleString(session.locale, { maximumFractionDigits: 1 }) })}</p>
  <p class="analytics-caption">{activity.coverageStart ? fill(session.text.usageActivityCoverage, { date: activity.coverageStart }) : session.text.usageActivityNoRecords}</p>
</section>

<div class="usage-activity-frequency">
  <div class="usage-activity-frequency-heading"><strong>{session.text.usageActivityScenarios}</strong><nav class="memory-center-tabs usage-activity-dimensions" aria-label={session.text.usageActivityScenarios}>{#each dimensions as item}<button type="button" class:active={dimension === item.id} aria-pressed={dimension === item.id} onclick={() => dimension = item.id}>{item.label}</button>{/each}</nav></div>
  <p class="usage-activity-scope">{session.text.usageActivityScenariosHint}</p>
  <AnalyticsRanking title={dimensions.find(item => item.id === dimension)!.label} {rows} unit={session.text.usageActivityFrequency} total={activity.requests} />
</div>

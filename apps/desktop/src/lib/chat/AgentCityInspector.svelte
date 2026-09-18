<script lang="ts">
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import type { AgentCityFloor, AgentCityStatus } from "./agentCityProjection";

  export let floor: AgentCityFloor;
  export let copy: Translation;
  export let statusLabel: (status: AgentCityStatus) => string;
  export let channelLabel: (channel: string) => string;
  export let activityTime: (value: string) => string;
  export let onClose: () => void;
  export let onFocus: () => void;
  export let onOpenChat: (agentId: string) => void;
  export let onOpenSettings: () => void;

  type InspectorTab = "overview" | "workers" | "runtime";
  let tab: InspectorTab = "overview";
  let floorKey = "";

  $: if (floor.key !== floorKey) {
    floorKey = floor.key;
    tab = "overview";
  }

  $: textModel = floor.agent.modelRouting.textModelKey || copy.agentStudioDefaultRoute;
  $: sttModel = floor.agent.modelRouting.sttModelKey || copy.agentCityInspectorInherited;
  $: permission = floor.agent.permissionMode
    ? {
        plan: copy.permissionModePlan,
        manual: copy.permissionModeManual,
        accept_edits: copy.permissionModeAcceptEdits,
        auto: copy.permissionModeAuto
      }[floor.agent.permissionMode]
    : copy.agentCityInspectorInherited;

  function shortRunId(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= 18) return trimmed;
    return `${trimmed.slice(0, 8)}…${trimmed.slice(-7)}`;
  }

  function workerStatus(status: "working" | "completed" | "error"): string {
    return statusLabel(status);
  }
</script>

<aside class="agent-city-inspector" aria-label={copy.agentCityInspectorTitle}>
  <header class="agent-city-inspector-head">
    <div>
      <span class="agent-city-inspector-kicker">{floor.kind === "global" ? copy.agentCityHeadquarters : copy.agentCityBuilding}</span>
      <strong>{floor.agent.name}</strong>
    </div>
    <span class="agent-city-inspector-status" data-status={floor.state}>{statusLabel(floor.state)}</span>
    <button type="button" aria-label={copy.agentCityCloseDetail} title={copy.agentCityCloseDetail} onclick={onClose}>
      <X size={15} aria-hidden="true" />
    </button>
  </header>

  <nav class="agent-city-inspector-tabs" aria-label={copy.agentCityInspectorTitle}>
    <button type="button" class:active={tab === "overview"} aria-pressed={tab === "overview"} onclick={() => (tab = "overview")}>{copy.agentCityInspectorOverview}</button>
    <button type="button" class:active={tab === "workers"} aria-pressed={tab === "workers"} onclick={() => (tab = "workers")}>
      {copy.agentCityInspectorWorkers}
      {#if floor.subagents.instances.length}<span>{floor.subagents.instances.length}</span>{/if}
    </button>
    <button type="button" class:active={tab === "runtime"} aria-pressed={tab === "runtime"} onclick={() => (tab = "runtime")}>{copy.agentCityInspectorRuntime}</button>
  </nav>

  <div class="agent-city-inspector-body">
    {#if tab === "overview"}
      <section class="agent-city-inspector-section">
        <p class="agent-city-inspector-description">{floor.agent.description || copy.agentStudioNoDescription}</p>
      </section>

      <section class="agent-city-inspector-section">
        <h3>{copy.agentStudioCurrentTask}</h3>
        {#if floor.activity}
          <div class="agent-city-inspector-task" data-status={floor.state}>
            <p>{floor.activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
            <small>{floor.activity.botName} · {channelLabel(floor.activity.channel)} · {activityTime(floor.activity.startedAt)}</small>
          </div>
        {:else}
          <p class="agent-city-inspector-empty">{copy.agentCityInspectorNoActiveTask}</p>
        {/if}
      </section>

      <section class="agent-city-inspector-section">
        <h3>{copy.agentCityInspectorConfiguration}</h3>
        <dl class="agent-city-inspector-facts">
          <div><dt>{copy.model}</dt><dd title={textModel}>{textModel}</dd></div>
          <div><dt>{copy.permissionMode}</dt><dd>{permission}</dd></div>
          <div><dt>{copy.agentCityInspectorModelRoutes}</dt><dd>{floor.agent.modelOverrides > 0 ? String(floor.agent.modelOverrides) : copy.agentCityInspectorInherited}</dd></div>
          <div><dt>{copy.agentCityInspectorWorkerCount}</dt><dd>{floor.subagents.instances.length}</dd></div>
        </dl>
      </section>

      {#if floor.subagents.groups.length}
        <section class="agent-city-inspector-section">
          <h3>{copy.agentCityInspectorTeamNow}</h3>
          <div class="agent-city-inspector-team-chips">
            {#each floor.subagents.groups as group (group.role)}
              <span>{group.role} ×{group.total}</span>
            {/each}
          </div>
        </section>
      {/if}
    {:else if tab === "workers"}
      <section class="agent-city-inspector-section">
        <h3>{copy.agentCityInspectorWorkerTeam}</h3>
        {#if floor.subagents.groups.length}
          <div class="agent-city-worker-groups">
            {#each floor.subagents.groups as group (group.role)}
              <article class="agent-city-worker-group">
                <header>
                  <strong>{group.role}</strong>
                  <span>×{group.total}</span>
                </header>
                <div class="agent-city-worker-summary">
                  {#if group.working}<span data-status="working">{group.working} {copy.agentStudioWorking}</span>{/if}
                  {#if group.completed}<span data-status="completed">{group.completed} {copy.agentStudioCompleted}</span>{/if}
                  {#if group.error}<span data-status="error">{group.error} {copy.agentStudioFailed}</span>{/if}
                </div>
                <ul>
                  {#each group.instances as worker (worker.id)}
                    <li>
                      <i data-status={worker.status}></i>
                      <span title={worker.id}>{worker.id.length > 18 ? `${worker.id.slice(0, 8)}…${worker.id.slice(-6)}` : worker.id}</span>
                      <small>{workerStatus(worker.status)}</small>
                      <time>{activityTime(worker.startedAt)}</time>
                    </li>
                  {/each}
                </ul>
              </article>
            {/each}
          </div>
        {:else}
          <p class="agent-city-inspector-empty">{copy.agentCityInspectorNoWorkers}</p>
        {/if}
      </section>
    {:else}
      <section class="agent-city-inspector-section">
        <h3>{copy.agentCityInspectorRuntime}</h3>
        <dl class="agent-city-inspector-facts agent-city-inspector-facts--runtime">
          <div><dt>{copy.agentStudioActivityStatus}</dt><dd><span class="agent-city-runtime-status" data-status={floor.state}>{statusLabel(floor.state)}</span></dd></div>
          <div><dt>{copy.agentCityInspectorAgentId}</dt><dd title={floor.agent.id}>{floor.agent.id}</dd></div>
          <div><dt>{copy.agentCityInspectorTextModel}</dt><dd title={textModel}>{textModel}</dd></div>
          <div><dt>{copy.agentCityInspectorSpeechModel}</dt><dd title={sttModel}>{sttModel}</dd></div>
          {#if floor.activity}
            <div><dt>{copy.agentCityInspectorRunId}</dt><dd title={floor.activity.runId}>{shortRunId(floor.activity.runId)}</dd></div>
            <div><dt>{copy.agentStudioWorkingFor}</dt><dd>{floor.activity.botName}</dd></div>
            <div><dt>{copy.agentCityInspectorBotId}</dt><dd title={floor.activity.botId}>{floor.activity.botId}</dd></div>
            <div><dt>{copy.agentStudioChannel}</dt><dd>{channelLabel(floor.activity.channel)}</dd></div>
            <div><dt>{copy.agentStudioStartedAt}</dt><dd>{activityTime(floor.activity.startedAt)}</dd></div>
            {#if floor.activity.finishedAt}<div><dt>{copy.agentCityInspectorFinishedAt}</dt><dd>{activityTime(floor.activity.finishedAt)}</dd></div>{/if}
          {/if}
        </dl>
      </section>
    {/if}
  </div>

  <footer class="agent-city-inspector-actions">
    <button type="button" class="primary" onclick={() => onOpenChat(floor.agent.id)}>{copy.agentCityInspectorOpenChat}</button>
    <button type="button" onclick={onFocus}>{copy.agentCityFocusFloor}</button>
    <button type="button" onclick={onOpenSettings}>{copy.agentCityOpenAgentSettings}</button>
  </footer>
</aside>

<style>
  .agent-city-inspector {
    position: absolute;
    z-index: 14;
    top: 56px;
    right: 16px;
    bottom: 16px;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    width: min(360px, calc(100% - 32px));
    overflow: hidden;
    border: 1px solid var(--chrome-border);
    border-radius: var(--rounded-lg);
    background: var(--agent-city-surface-strong);
    box-shadow: var(--float-shadow);
    color: var(--label-primary);
    backdrop-filter: blur(18px);
    animation: agent-city-inspector-in var(--duration-normal) var(--ease-spring) both;
  }
  .agent-city-inspector-head { display: grid; grid-template-columns: minmax(0, 1fr) auto 28px; align-items: center; gap: 8px; min-height: 58px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--separator); }
  .agent-city-inspector-head > div { display: grid; min-width: 0; gap: 1px; }
  .agent-city-inspector-kicker { color: var(--label-tertiary); font-size: var(--fs-meta); }
  .agent-city-inspector-head strong { overflow: hidden; font-size: var(--fs-body); line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
  .agent-city-inspector-head > button { display: grid; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-secondary); cursor: pointer; place-items: center; }
  .agent-city-inspector-head > button:hover { background: var(--fill); color: var(--label-primary); }
  .agent-city-inspector-status, .agent-city-runtime-status { padding: 2px 7px; border-radius: 999px; background: var(--fill); color: var(--label-secondary); font-size: var(--fs-meta); white-space: nowrap; }
  :is(.agent-city-inspector-status, .agent-city-runtime-status)[data-status="working"] { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  :is(.agent-city-inspector-status, .agent-city-runtime-status)[data-status="completed"] { background: color-mix(in srgb, var(--online) 16%, transparent); color: var(--online); }
  :is(.agent-city-inspector-status, .agent-city-runtime-status)[data-status="error"] { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .agent-city-inspector-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; padding: 6px; border-bottom: 1px solid var(--separator); }
  .agent-city-inspector-tabs button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 8px; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-secondary); font-size: var(--fs-meta); cursor: pointer; }
  .agent-city-inspector-tabs button:hover { background: var(--fill); color: var(--label-primary); }
  .agent-city-inspector-tabs button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .agent-city-inspector-tabs button span { min-width: 16px; padding: 0 4px; border-radius: 8px; background: color-mix(in srgb, currentColor 12%, transparent); font: 600 10px/16px var(--font-mono); }
  .agent-city-inspector-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 14px 14px; }
  .agent-city-inspector-section { padding: 12px 0; border-bottom: 1px solid var(--separator); }
  .agent-city-inspector-section:last-child { border-bottom: 0; }
  .agent-city-inspector-section h3 { margin: 0 0 8px; color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 600; }
  .agent-city-inspector-description { margin: 0; color: var(--label-secondary); font-size: var(--fs-label); line-height: 1.5; }
  .agent-city-inspector-task { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--separator); border-radius: var(--rounded-md); background: color-mix(in srgb, var(--card-bg) 82%, transparent); }
  .agent-city-inspector-task[data-status="working"] { border-color: color-mix(in srgb, var(--accent) 34%, var(--separator)); background: color-mix(in srgb, var(--accent) 6%, var(--card-bg)); }
  .agent-city-inspector-task p { margin: 0; color: var(--label-primary); font-size: var(--fs-label); line-height: 1.45; }
  .agent-city-inspector-task small { color: var(--label-tertiary); font-size: var(--fs-meta); }
  .agent-city-inspector-empty { margin: 0; padding: 12px; border: 1px dashed var(--separator); border-radius: var(--rounded-md); color: var(--label-tertiary); font-size: var(--fs-meta); text-align: center; }
  .agent-city-inspector-facts { display: grid; margin: 0; gap: 0; }
  .agent-city-inspector-facts > div { display: grid; grid-template-columns: minmax(92px, .8fr) minmax(0, 1.35fr); align-items: center; gap: 10px; min-height: 30px; border-bottom: 1px solid color-mix(in srgb, var(--separator) 60%, transparent); }
  .agent-city-inspector-facts > div:last-child { border-bottom: 0; }
  .agent-city-inspector-facts dt { color: var(--label-tertiary); font-size: var(--fs-meta); }
  .agent-city-inspector-facts dd { min-width: 0; margin: 0; overflow: hidden; color: var(--label-primary); font-size: var(--fs-meta); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
  .agent-city-inspector-facts--runtime dd { font-family: var(--font-mono); font-size: 10px; }
  .agent-city-inspector-team-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .agent-city-inspector-team-chips span { padding: 3px 7px; border: 1px solid var(--separator); border-radius: 999px; background: var(--fill); color: var(--label-secondary); font-size: var(--fs-meta); }
  .agent-city-worker-groups { display: grid; gap: 8px; }
  .agent-city-worker-group { overflow: hidden; border: 1px solid var(--separator); border-radius: var(--rounded-md); background: color-mix(in srgb, var(--card-bg) 78%, transparent); }
  .agent-city-worker-group > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 10px; border-bottom: 1px solid var(--separator); }
  .agent-city-worker-group > header strong { overflow: hidden; font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
  .agent-city-worker-group > header span { color: var(--label-tertiary); font: 600 10px/16px var(--font-mono); }
  .agent-city-worker-summary { display: flex; flex-wrap: wrap; gap: 5px; padding: 7px 10px 0; }
  .agent-city-worker-summary span { padding: 2px 5px; border-radius: var(--rounded-sm); background: var(--fill); color: var(--label-secondary); font-size: 10px; }
  .agent-city-worker-summary span[data-status="working"] { color: var(--accent); }
  .agent-city-worker-summary span[data-status="completed"] { color: var(--online); }
  .agent-city-worker-summary span[data-status="error"] { color: var(--danger); }
  .agent-city-worker-group ul { display: grid; max-height: 220px; margin: 0; padding: 6px 10px 9px; overflow: auto; gap: 3px; list-style: none; }
  .agent-city-worker-group li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 7px; min-height: 24px; color: var(--label-secondary); font-size: var(--fs-meta); }
  .agent-city-worker-group li i { width: 6px; height: 6px; border-radius: 50%; background: var(--label-tertiary); }
  .agent-city-worker-group li i[data-status="working"] { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
  .agent-city-worker-group li i[data-status="completed"] { background: var(--online); }
  .agent-city-worker-group li i[data-status="error"] { background: var(--danger); }
  .agent-city-worker-group li > span { overflow: hidden; font-family: var(--font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .agent-city-worker-group li small, .agent-city-worker-group li time { color: var(--label-tertiary); font-size: 10px; white-space: nowrap; }
  .agent-city-inspector-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; border-top: 1px solid var(--separator); background: color-mix(in srgb, var(--card-bg) 90%, transparent); }
  .agent-city-inspector-actions button { height: 30px; padding: 0 9px; border: 1px solid var(--separator); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-primary); font-size: var(--fs-meta); cursor: pointer; }
  .agent-city-inspector-actions button:hover { background: var(--fill); }
  .agent-city-inspector-actions button.primary { grid-column: 1 / -1; border-color: color-mix(in srgb, var(--accent) 55%, var(--separator)); background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .agent-city-inspector-actions button:focus-visible, .agent-city-inspector-tabs button:focus-visible, .agent-city-inspector-head > button:focus-visible { outline: 0; box-shadow: inset 0 0 0 2px var(--accent); }

  @keyframes agent-city-inspector-in {
    from { opacity: 0; transform: translateX(12px) scale(.985); }
    to { opacity: 1; transform: translateX(0) scale(1); }
  }
  @media (max-width: 760px) {
    .agent-city-inspector { left: 14px; right: 14px; top: 74px; bottom: 14px; width: auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-city-inspector { animation: none; }
  }
</style>

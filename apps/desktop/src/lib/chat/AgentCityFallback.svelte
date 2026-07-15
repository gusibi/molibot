<script lang="ts">
  import type { Translation } from "../i18n";
  import type { AgentCityFloor, AgentCityProjection, AgentCityStatus } from "./agentCityProjection";

  export let projection: AgentCityProjection;
  export let copy: Translation;
  export let statusLabel: (status: AgentCityStatus) => string;
  export let onOpenAgentSettings: () => void;

  function floorTitle(floor: AgentCityFloor): string {
    return `${floor.agent.name} · ${statusLabel(floor.state)}`;
  }

  function shortBotName(name: string): string {
    const value = name.trim();
    return value.length > 16 ? `${value.slice(0, 15)}…` : value;
  }

  function channelLabel(channel: string): string {
    if (channel === "feishu") return copy.channelFeishu;
    if (channel === "weixin") return copy.channelWeixin;
    if (channel === "telegram") return "Telegram";
    if (channel === "qq") return "QQ";
    if (channel === "web") return "Web";
    return channel;
  }

  function activityTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }
</script>

<div class="agent-city-fallback" aria-label={copy.agentCityFallbackLabel}>
  <div class="agent-city-fallback-landmark agent-city-fallback-owner">
    <i class="ph ph-command" aria-hidden="true"></i>
    <div><strong>{copy.agentStudioOwner}</strong><span>{projection.owner.active ? copy.agentStudioCollaborating : copy.agentStudioOwnerIdle}</span></div>
  </div>
  <button class="agent-city-fallback-landmark agent-city-fallback-global" data-status={projection.globalFloor.state} type="button" aria-label={floorTitle(projection.globalFloor)} aria-describedby="agent-city-fallback-global-details">
    <i class="ph ph-buildings" aria-hidden="true"></i>
    <div><strong>{projection.globalFloor.agent.name}</strong><span>{statusLabel(projection.globalFloor.state)}</span></div>
    <span class="agent-city-fallback-details" id="agent-city-fallback-global-details" role="tooltip">
      <strong>{projection.globalFloor.agent.description || copy.agentStudioNoDescription}</strong>
      {#if projection.globalFloor.activity}
        <small>{shortBotName(projection.globalFloor.activity.botName)} · {channelLabel(projection.globalFloor.activity.channel)} · {activityTime(projection.globalFloor.activity.startedAt)}</small>
        <span>{projection.globalFloor.activity.taskPreview || copy.agentStudioTaskUnavailable}</span>
      {/if}
      <em>{projection.globalFloor.agent.modelOverrides > 0 ? `${projection.globalFloor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</em>
    </span>
  </button>

  <div class="agent-city-fallback-grid">
    {#each projection.buildings as building (building.index)}
      <section class="agent-city-fallback-building" aria-label={`${copy.agentCityBuilding} ${building.index + 1}`}>
        <header><span>{String(building.index + 1).padStart(2, "0")}</span><small>{building.floors.length} {copy.agentCityFloors}</small></header>
        <div class="agent-city-fallback-floors">
          {#each [...building.floors].reverse() as floor (floor.key)}
            <button class="agent-city-fallback-floor" data-status={floor.state} title={floorTitle(floor)} type="button" aria-describedby={`agent-city-fallback-details-${building.index}-${floor.floorIndex}`}>
              <span class="agent-city-fallback-pug" aria-hidden="true"><i></i><b></b></span>
              <span><strong>{floor.agent.name}</strong><small>{statusLabel(floor.state)}</small></span>
              {#if floor.subagents.visible.length || floor.subagents.overflowCount}
                <em>{floor.subagents.visible.length + floor.subagents.overflowCount} {copy.agentStudioSubagents}</em>
              {/if}
              <span class="agent-city-fallback-details" id={`agent-city-fallback-details-${building.index}-${floor.floorIndex}`} role="tooltip">
                <strong>{floor.agent.description || copy.agentStudioNoDescription}</strong>
                {#if floor.activity}
                  <small>{shortBotName(floor.activity.botName)} · {channelLabel(floor.activity.channel)} · {activityTime(floor.activity.startedAt)}</small>
                  <span>{floor.activity.taskPreview || copy.agentStudioTaskUnavailable}</span>
                {/if}
                <em>{floor.agent.modelOverrides > 0 ? `${floor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</em>
                {#if floor.subagents.visible.length || floor.subagents.overflowCount}
                  <span>{floor.subagents.visible.map((subagent) => `${subagent.name} · ${statusLabel(subagent.status)}`).join(" · ")}{floor.subagents.overflowCount ? ` · +${floor.subagents.overflowCount}` : ""}</span>
                {/if}
              </span>
            </button>
          {:else}
            <div class="agent-city-fallback-vacant"><span>{copy.agentCityVacant}</span></div>
          {/each}
        </div>
      </section>
    {/each}
  </div>

  {#if projection.hiddenAgentCount > 0}
    <p class="agent-city-overflow"><strong>+{projection.hiddenAgentCount}</strong> {copy.agentCityOverflow}</p>
  {/if}
  {#if projection.buildings.every((building) => building.floors.length === 0)}
    <button class="secondary-button" type="button" onclick={onOpenAgentSettings}>{copy.agentStudioCreate}</button>
  {/if}
</div>

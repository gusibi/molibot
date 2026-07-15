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
</script>

<div class="agent-city-fallback" aria-label={copy.agentCityFallbackLabel}>
  <div class="agent-city-fallback-landmark agent-city-fallback-owner">
    <i class="ph ph-command" aria-hidden="true"></i>
    <div><strong>{copy.agentStudioOwner}</strong><span>{projection.owner.active ? copy.agentStudioCollaborating : copy.agentStudioOwnerIdle}</span></div>
  </div>
  <div class="agent-city-fallback-landmark agent-city-fallback-global" data-status={projection.globalFloor.state}>
    <i class="ph ph-buildings" aria-hidden="true"></i>
    <div><strong>{projection.globalFloor.agent.name}</strong><span>{statusLabel(projection.globalFloor.state)}</span></div>
  </div>

  <div class="agent-city-fallback-grid">
    {#each projection.buildings as building (building.index)}
      <section class="agent-city-fallback-building" aria-label={`${copy.agentCityBuilding} ${building.index + 1}`}>
        <header><span>{String(building.index + 1).padStart(2, "0")}</span><small>{building.floors.length} {copy.agentCityFloors}</small></header>
        <div class="agent-city-fallback-floors">
          {#each [...building.floors].reverse() as floor (floor.key)}
            <button class="agent-city-fallback-floor" data-status={floor.state} title={floorTitle(floor)} type="button">
              <span class="agent-city-fallback-pug" aria-hidden="true"><i></i><b></b></span>
              <span><strong>{floor.agent.name}</strong><small>{statusLabel(floor.state)}</small></span>
              {#if floor.subagents.visible.length || floor.subagents.overflowCount}
                <em>{floor.subagents.visible.length + floor.subagents.overflowCount} {copy.agentStudioSubagents}</em>
              {/if}
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

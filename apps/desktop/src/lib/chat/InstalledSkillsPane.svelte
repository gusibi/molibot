<script lang="ts">
  import type { Translation } from "../i18n";
  import { skillsStore, loadSkills } from "../stores/skills.svelte";

  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;

  let loadedEndpoint = "";
  let query = "";
  let expandedIds = new Set<string>();
  $: if (serviceReady && serviceEndpoint && serviceEndpoint !== loadedEndpoint) {
    loadedEndpoint = serviceEndpoint;
    void loadSkills(serviceEndpoint);
  }

  function scopeLabel(scope: "global" | "bot" | "chat" | "project"): string {
    if (scope === "project") return copy.skillScopeProject;
    if (scope === "bot") return copy.skillScopeBot;
    if (scope === "chat") return copy.skillScopeChat;
    return copy.skillScopeGlobal;
  }

  $: normalizedQuery = query.trim().toLowerCase();
  $: filteredSkills = skillsStore.skills?.items.filter((skill) => !normalizedQuery || [skill.name, skill.description, skill.scope, skill.botId, skill.chatId].join("\n").toLowerCase().includes(normalizedQuery)) ?? [];

  function toggleDescription(id: string): void {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedIds = next;
  }
</script>

{#if !serviceReady}
  <div class="workspace-empty"><p>{copy.skillsUnavailable}</p></div>
{:else if skillsStore.loading || !skillsStore.skills}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.skills.items.length === 0}
  <div class="workspace-empty"><p>{copy.skillsEmpty}</p></div>
{:else}
  <div class="installed-skills-toolbar">
    <label class="installed-skills-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input bind:value={query} aria-label={copy.skillsFilter} placeholder={copy.skillsFilterHint} /></label>
    <div class="installed-skills-summary"><span>{copy.skillsTotal} <strong>{skillsStore.skills.counts.total}</strong></span><span>{copy.agentsEnabledCount} <strong>{skillsStore.skills.counts.enabled}</strong></span></div>
  </div>
  {#if filteredSkills.length === 0}
    <div class="workspace-empty compact"><p>{copy.skillsNoMatches}</p></div>
  {:else}
  <div class="installed-skills-grid">
    {#each filteredSkills as skill (skill.id)}
      <article class="installed-skill-card">
        <div class="installed-skill-icon" aria-hidden="true"><i class="ph-fill ph-magic-wand"></i></div>
        <div class="installed-skill-copy">
          <div class="installed-skill-title">
            <strong>{skill.name}</strong>
            <span class="status-badge" data-state={skill.enabled ? "ready" : "disconnected"}>
              {skill.enabled ? copy.providerEnabled : copy.providerDisabled}
            </span>
          </div>
          {#if skill.description}<p class:expanded={expandedIds.has(skill.id)}>{skill.description}</p>{/if}
          <div class="installed-skill-meta">
            <span>{scopeLabel(skill.scope)}</span>
            {#if skill.botId}<span>{skill.botId}</span>{/if}
            {#if skill.chatId}<span>{skill.chatId}</span>{/if}
            {#if skill.mcpServerCount > 0}<span>{copy.skillMcpServers}: {skill.mcpServerCount}</span>{/if}
          </div>
          {#if skill.description}<button class="installed-skill-expand" type="button" aria-expanded={expandedIds.has(skill.id)} onclick={() => toggleDescription(skill.id)}>{expandedIds.has(skill.id) ? copy.skillsShowLess : copy.skillsShowMore}<i class={`ph ph-caret-${expandedIds.has(skill.id) ? "up" : "down"}`} aria-hidden="true"></i></button>{/if}
        </div>
      </article>
    {/each}
  </div>
  {/if}
{/if}

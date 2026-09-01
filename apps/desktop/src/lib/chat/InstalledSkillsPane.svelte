<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleUp from "reicon-svelte/icons/AngleUp";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import MagicWand from "reicon-svelte/icons/MagicWand";
  import type { Translation } from "../i18n";
  import { skillsStore, loadSkills } from "../stores/skills.svelte";

  let { copy, serviceEndpoint, serviceReady }: {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
  } = $props();

  let loadedEndpoint = $state("");
  let query = $state("");
  let expandedIds = $state(new Set<string>());

  $effect(() => {
    if (serviceReady && serviceEndpoint && serviceEndpoint !== loadedEndpoint) {
      loadedEndpoint = serviceEndpoint;
      void loadSkills(serviceEndpoint);
    }
  });

  function scopeLabel(scope: "global" | "bot" | "chat" | "project"): string {
    if (scope === "project") return copy.skillScopeProject;
    if (scope === "bot") return copy.skillScopeBot;
    if (scope === "chat") return copy.skillScopeChat;
    return copy.skillScopeGlobal;
  }

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filteredSkills = $derived(skillsStore.skills?.items.filter((skill) => !normalizedQuery || [skill.name, skill.description, skill.scope, skill.botId, skill.chatId].join("\n").toLowerCase().includes(normalizedQuery)) ?? []);

  function toggleDescription(id: string): void {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedIds = next;
  }
</script>

{#if !serviceReady}
  <div class="workspace-empty"><p>{copy.skillsUnavailable}</p></div>
{:else if skillsStore.loading}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.error && !skillsStore.skills}
  <div class="workspace-empty" role="alert"><p>{copy.workspaceLoadFailed}</p><small>{skillsStore.error}</small><button class="secondary-button" type="button" onclick={() => serviceEndpoint && void loadSkills(serviceEndpoint)}>{copy.retryLoading}</button></div>
{:else if !skillsStore.skills}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.skills.items.length === 0}
  <div class="workspace-empty"><p>{copy.skillsEmpty}</p></div>
{:else}
  <div class="installed-skills-toolbar">
    <label class="installed-skills-search"><Magnifier size={14} aria-hidden="true" /><input bind:value={query} autocomplete="off" spellcheck="false" aria-label={copy.skillsFilter} placeholder={copy.skillsFilterHint} /></label>
    <div class="installed-skills-summary"><span>{copy.skillsTotal} <strong>{skillsStore.skills.counts.total}</strong></span><span>{copy.agentsEnabledCount} <strong>{skillsStore.skills.counts.enabled}</strong></span></div>
  </div>
  {#if filteredSkills.length === 0}
    <div class="workspace-empty compact"><p>{copy.skillsNoMatches}</p></div>
  {:else}
  <div class="installed-skills-grid">
    {#each filteredSkills as skill (skill.id)}
      <article class="installed-skill-card">
        <div class="installed-skill-icon" aria-hidden="true"><MagicWand weight="Filled" size={16} /></div>
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
          {#if skill.description}<button class="installed-skill-expand" type="button" aria-expanded={expandedIds.has(skill.id)} onclick={() => toggleDescription(skill.id)}>{expandedIds.has(skill.id) ? copy.skillsShowLess : copy.skillsShowMore}{#if expandedIds.has(skill.id)}<AngleUp size={12} aria-hidden="true" />{:else}<AngleDown size={12} aria-hidden="true" />{/if}</button>{/if}
        </div>
      </article>
    {/each}
  </div>
  {/if}
{/if}

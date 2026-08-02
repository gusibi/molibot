<script lang="ts">
  import { miniAppsStore, recentMiniApps, hasMoreThanRecent, loadMiniApps } from "../stores/miniapps.svelte";
  import MiniAppIcon from "./MiniAppIcon.svelte";

  /**
   * Mini Apps sidebar section — a sibling of Conversations and Projects.
   *
   * The section is named Mini Apps, while its contents are ordered by recent use
   * and capped at ten. "All" opens the full manager. Only apps that are enabled
   * and loaded appear here; a disabled or broken app belongs in the manager,
   * where its reason is visible.
   */
  let {
    copy,
    endpoint,
    expanded,
    activeAppId,
    onToggle,
    onOpenApp,
    onSeeAll
  }: {
    copy: Record<string, string>;
    endpoint: string;
    expanded: boolean;
    activeAppId: string;
    onToggle: () => void;
    onOpenApp: (appId: string) => void;
    onSeeAll: () => void;
  } = $props();

  let lastEndpoint = $state("");

  // Load once per endpoint. Gating on the value actually changing keeps this
  // from re-firing on every unrelated store tick.
  $effect(() => {
    if (endpoint && endpoint !== lastEndpoint) {
      lastEndpoint = endpoint;
      void loadMiniApps(endpoint);
    }
  });

  const apps = $derived(recentMiniApps());
  const showSeeAll = $derived(hasMoreThanRecent());
</script>

{#if apps.length > 0 || miniAppsStore.loaded}
  <section class="miniapps-section">
    <button type="button" class="sidebar-section-head sidebar-section-toggle" aria-expanded={expanded} onclick={onToggle}>
      <span>{copy.miniAppsRecent}</span>
      <i class="ph ph-caret-right sidebar-section-caret" class:open={expanded} aria-hidden="true"></i>
    </button>

    {#if expanded}
      {#if apps.length === 0}
        <p class="miniapps-empty">{copy.miniAppsEmpty}</p>
      {:else}
        <ul class="miniapps-list">
          {#each apps as app (app.id)}
            <li>
              <button
                type="button"
                class="miniapps-item"
                class:active={activeAppId === app.id}
                aria-current={activeAppId === app.id ? "true" : undefined}
                title={app.description || app.name}
                onclick={() => onOpenApp(app.id)}
              >
                <MiniAppIcon src={app.iconDataUri} label={app.name} size="sidebar" />
                <span class="miniapps-item-name">{app.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if showSeeAll || apps.length === 0}
        <button type="button" class="miniapps-see-all" onclick={onSeeAll}>{copy.miniAppsSeeAll}</button>
      {/if}
    {/if}
  </section>
{/if}

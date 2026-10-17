<script lang="ts">
  import ChevronLeft from "reicon-svelte/icons/ChevronLeft";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import Button from "../components/ui/Button.svelte";
  import PlusCircle from "reicon-svelte/icons/PlusCircle";
  import Tuning from "reicon-svelte/icons/Tuning";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { session } from "../stores/session.svelte";
  import MiniAppIcon from "./MiniAppIcon.svelte";
  import MiniAppsManager from "./MiniAppsManager.svelte";
  import { miniAppsStore, loadMiniApps } from "../stores/miniapps.svelte";

  /**
   * The Mini Apps destination opens on a Launchpad: one tile per *usable* app
   * (enabled and loaded), icon and name only, and a click launches it. Every
   * lifecycle concern — install, toggle, uninstall, AI routing — stays one
   * "Manage" click away in {@link MiniAppsManager}, so the launcher keeps its
   * one-job simplicity instead of drifting back into a settings page.
   */
  let {
    onOpenApp,
    onOpenAiSettings
  }: {
    onOpenApp?: (appId: string) => void;
    /** Forwarded to the manager, which owns the AI settings shortcut. */
    onOpenAiSettings?: () => void;
  } = $props();

  let view = $state<"launchpad" | "manage">("launchpad");
  let searchQuery = $state("");
  let lastEndpoint = $state("");
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== lastEndpoint) {
      lastEndpoint = session.endpoint;
      void loadMiniApps(session.endpoint);
    }
  });

  const normalizedQuery = $derived(searchQuery.trim().toLowerCase());
  const errorCount = $derived(miniAppsStore.items.filter((app) => app.status === "error").length);
  const launchpadApps = $derived(
    miniAppsStore.items.filter(
      (app) =>
        app.enabled &&
        app.status === "active" &&
        (!normalizedQuery || `${app.name}\n${app.description}`.toLowerCase().includes(normalizedQuery))
    )
  );
</script>

{#snippet headerActions()}
  <div class="workspace-header-tools">
    {#if view === "launchpad"}
      <WorkspaceSearch value={searchQuery} label={session.text.miniAppsSearchPlaceholder} placeholder={session.text.miniAppsSearchPlaceholder} closeLabel={session.text.closeSearch} onInput={(value) => (searchQuery = value)} />
    {/if}
  </div>
{/snippet}
<ChatHeader title={session.text.miniAppsNav} actions={headerActions} />
<div class="workspace-collection">
<p class="workspace-description">{session.text.miniAppsHint}</p>
{#if errorCount > 0}<p class="workspace-inline-warning" role="status">{session.text.miniAppCountError.replace("{n}", String(errorCount))}</p>{/if}

<section class="miniapps-launchpad">
  <div class="workspace-filterbar workspace-collection-filterbar miniapps-launchpad-toolbar">
    <span class="workspace-filter-count">{session.text.miniAppCountInstalled.replace("{n}", String(miniAppsStore.items.length))} · {session.text.miniAppCountActive.replace("{n}", String(miniAppsStore.items.filter((app) => app.enabled && app.status === "active").length))}</span>
    {#if view === "manage"}
      <Button variant="icon" title={session.text.miniAppsBackToLaunchpad} onclick={() => (view = "launchpad")}><ChevronLeft size={16} aria-hidden="true" /></Button>
    {:else}
      <Button variant="icon" title={session.text.miniAppsSettingsTitle} onclick={() => (view = "manage")}><Tuning size={16} aria-hidden="true" /></Button>
    {/if}
  </div>
  {#if view === "manage"}
    <MiniAppsManager {onOpenApp} {onOpenAiSettings} />
  {:else}
    {#if miniAppsStore.loading && miniAppsStore.items.length === 0}
      <div class="workspace-empty"><p>{session.text.loading}</p></div>
    {:else if miniAppsStore.items.length === 0}
      <div class="workspace-empty compact">
        <EmptyState title={session.text.miniAppsEmpty} icon="cube">
          <button type="button" class="primary-button miniapp-install-btn" onclick={() => (view = "manage")}>
            <PlusCircle size={15} aria-hidden="true" />
            <span>{session.text.miniAppInstallTitle}</span>
          </button>
        </EmptyState>
      </div>
    {:else if launchpadApps.length === 0}
      <div class="workspace-empty compact">
        {#if normalizedQuery}
          <p>{session.text.miniAppsSearchEmpty.replace("{query}", searchQuery.trim())}</p>
        {:else}
          <p>{session.text.miniAppsNoneEnabled}</p>
          <button type="button" class="secondary-button" onclick={() => (view = "manage")}>
            {session.text.miniAppsSettingsTitle}
          </button>
        {/if}
      </div>
    {:else}
      <ul class="miniapps-launchpad-grid" role="list">
        {#each launchpadApps as app, index (app.id)}
          <li class="miniapps-launchpad-cell" style="--stagger: {index}">
            <button
              type="button"
              class="miniapps-launchpad-item"
              title={app.description || app.name}
              onclick={() => onOpenApp?.(app.id)}
            >
              <span class="miniapps-launchpad-icon">
                <MiniAppIcon src={app.iconDataUri} label={app.name} size="launchpad" />
                {#if app.updateAvailable}
                  <span
                    class="miniapps-launchpad-badge"
                    title={session.text.miniAppUpdateAvailable.replace("{version}", app.availableVersion)}
                  ></span>
                {/if}
              </span>
              <span class="miniapps-launchpad-name">{app.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
</div>

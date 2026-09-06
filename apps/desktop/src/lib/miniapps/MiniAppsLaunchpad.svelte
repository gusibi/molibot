<script lang="ts">
  import ChevronLeft from "reicon-svelte/icons/ChevronLeft";
  import Magnifier from "reicon-svelte/icons/Magnifier";
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
    /** Forwarded to the manager, which owns the AI-routing signpost. */
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
  const installedCount = $derived(miniAppsStore.items.length);
  const activeCount = $derived(
    miniAppsStore.items.filter((app) => app.enabled && app.status === "active").length
  );
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

<section class="miniapps-launchpad">
  {#if view === "manage"}
    <div class="miniapps-launchpad-backbar">
      <button type="button" class="miniapps-launchpad-back" onclick={() => (view = "launchpad")}>
        <ChevronLeft size={15} aria-hidden="true" />
        <span>{session.text.miniAppsBackToLaunchpad}</span>
      </button>
    </div>
    <MiniAppsManager {onOpenApp} {onOpenAiSettings} />
  {:else}
    <div class="miniapps-toolbar">
      <label class="miniapps-search">
        <Magnifier size={14} aria-hidden="true" />
        <input
          bind:value={searchQuery}
          autocomplete="off"
          spellcheck="false"
          aria-label={session.text.miniAppsSearchPlaceholder}
          placeholder={session.text.miniAppsSearchPlaceholder}
        />
      </label>

      <div class="miniapps-toolbar-actions">
        <p class="miniapps-counts">
          {session.text.miniAppCountInstalled.replace("{n}", String(installedCount))}
          · {session.text.miniAppCountActive.replace("{n}", String(activeCount))}
          {#if errorCount > 0}· <span class="miniapps-error">{session.text.miniAppCountError.replace("{n}", String(errorCount))}</span>{/if}
        </p>

        <button type="button" class="primary-button miniapp-install-btn" onclick={() => (view = "manage")}>
          <Tuning size={15} aria-hidden="true" />
          <span>{session.text.miniAppsSettingsTitle}</span>
        </button>
      </div>
    </div>

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

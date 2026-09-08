<script lang="ts">
  import { tick } from "svelte";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import Grid from "reicon-svelte/icons/Grid";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Star from "reicon-svelte/icons/Star";
  import StarOff from "reicon-svelte/icons/StarOff";
  import type { DesktopMiniAppItem } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { loadMiniApps, miniAppsStore } from "../stores/miniapps.svelte";
  import MiniAppIcon from "./MiniAppIcon.svelte";
  import {
    loadMiniAppQuickAccess,
    recordMiniAppRecent,
    saveMiniAppQuickAccess,
    toggleMiniAppFavorite,
    type MiniAppQuickAccessState
  } from "./miniAppQuickAccess";

  let {
    copy,
    endpoint = "",
    onOpenApp = () => {},
    onOpenLaunchpad = () => {}
  }: {
    copy: Translation;
    endpoint?: string;
    onOpenApp?: (appId: string) => void;
    onOpenLaunchpad?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let loadedEndpoint = $state("");
  let catalogEndpoint = $state("");
  let quickAccess = $state<MiniAppQuickAccessState>({ favoriteIds: [], recentIds: [] });
  let menuElement = $state<HTMLElement>();
  let buttonElement = $state<HTMLButtonElement>();
  let searchElement = $state<HTMLInputElement>();

  $effect(() => {
    if (!endpoint || endpoint === loadedEndpoint) return;
    loadedEndpoint = endpoint;
    catalogEndpoint = "";
    quickAccess = loadMiniAppQuickAccess(
      typeof localStorage === "undefined" ? null : localStorage,
      endpoint
    );
    void loadMiniApps(endpoint).then(() => {
      if (loadedEndpoint === endpoint) catalogEndpoint = endpoint;
    });
  });

  const catalogReady = $derived(Boolean(endpoint) && catalogEndpoint === endpoint);
  const availableApps = $derived(
    (catalogReady ? miniAppsStore.items : [])
      .filter((app) => app.enabled && app.status === "active" && !app.error)
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  const normalizedQuery = $derived(query.trim().toLocaleLowerCase());
  const filteredApps = $derived(
    normalizedQuery
      ? availableApps.filter((app) => `${app.name}\n${app.description}`.toLocaleLowerCase().includes(normalizedQuery))
      : availableApps
  );
  const favoriteApps = $derived(
    availableApps.filter((app) => quickAccess.favoriteIds.includes(app.id))
  );
  const recentApps = $derived(
    quickAccess.recentIds
      .map((id) => availableApps.find((app) => app.id === id))
      .filter((app): app is DesktopMiniAppItem => app !== undefined && !quickAccess.favoriteIds.includes(app.id))
  );
  const hasSearch = $derived(Boolean(normalizedQuery));

  function persistQuickAccess(next: MiniAppQuickAccessState): void {
    quickAccess = next;
    saveMiniAppQuickAccess(
      typeof localStorage === "undefined" ? null : localStorage,
      endpoint,
      next
    );
  }

  async function toggleMenu(): Promise<void> {
    open = !open;
    if (!open) {
      query = "";
      buttonElement?.focus();
      return;
    }
    await tick();
    searchElement?.focus();
  }

  function closeMenu(restoreFocus = true): void {
    if (!open) return;
    open = false;
    query = "";
    if (restoreFocus) buttonElement?.focus();
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (!open || !menuElement) return;
    const target = event.target;
    if (target instanceof Node && !menuElement.contains(target)) closeMenu(false);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  function openApp(app: DesktopMiniAppItem): void {
    persistQuickAccess(recordMiniAppRecent(quickAccess, app.id));
    closeMenu(false);
    onOpenApp(app.id);
  }

  function toggleFavorite(event: MouseEvent, app: DesktopMiniAppItem): void {
    event.stopPropagation();
    persistQuickAccess(toggleMiniAppFavorite(quickAccess, app.id));
  }

  function retry(): void {
    if (!endpoint) return;
    catalogEndpoint = "";
    void loadMiniApps(endpoint).then(() => {
      if (loadedEndpoint === endpoint) catalogEndpoint = endpoint;
    });
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<div class="miniapps-quick" bind:this={menuElement}>
  <button
    bind:this={buttonElement}
    class="icon-button miniapps-quick-trigger"
    type="button"
    aria-label={copy.miniAppsQuickMenu}
    title={copy.miniAppsQuickMenu}
    aria-expanded={open}
    aria-controls="miniapps-quick-menu"
    onclick={() => void toggleMenu()}
  >
    <Grid size={16} aria-hidden="true" />
    <span class="miniapps-quick-trigger-label">{copy.miniAppsNav}</span>
  </button>

  {#if open}
    <div id="miniapps-quick-menu" class="miniapps-quick-menu" role="dialog" aria-label={copy.miniAppsQuickMenu}>
      <label class="miniapps-quick-search">
        <Magnifier size={14} aria-hidden="true" />
        <input
          bind:this={searchElement}
          bind:value={query}
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder={copy.miniAppsQuickSearchPlaceholder}
          aria-label={copy.miniAppsQuickSearchPlaceholder}
        />
      </label>

      {#if !catalogReady || miniAppsStore.loading}
        <p class="miniapps-quick-state">{copy.loading}</p>
      {:else if miniAppsStore.loadError}
        <div class="miniapps-quick-state miniapps-quick-error" role="alert">
          <span>{copy.miniAppsQuickLoadFailed}</span>
          <button type="button" class="miniapps-quick-retry" onclick={retry}>{copy.retryLoading}</button>
        </div>
      {:else if availableApps.length === 0}
        <p class="miniapps-quick-state">{copy.miniAppsNoneEnabled}</p>
      {:else if hasSearch}
        {#if filteredApps.length === 0}
          <p class="miniapps-quick-state">{copy.miniAppsSearchEmpty.replace("{query}", query.trim())}</p>
        {:else}
          <div class="miniapps-quick-list" role="list" aria-label={copy.miniAppsQuickSearchPlaceholder}>
            {#each filteredApps as app (app.id)}
              <div class="miniapps-quick-row" role="listitem" aria-label={app.name}>
                <button class="miniapps-quick-open" type="button" onclick={() => openApp(app)}>
                  <MiniAppIcon src={app.iconDataUri} label={app.name} size="list" />
                  <span class="miniapps-quick-name">
                    <strong>{app.name}</strong>
                    {#if app.description}<small>{app.description}</small>{/if}
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="miniapps-quick-favorite"
                  aria-label={quickAccess.favoriteIds.includes(app.id) ? copy.miniAppsUnfavorite : copy.miniAppsFavorite}
                  title={quickAccess.favoriteIds.includes(app.id) ? copy.miniAppsUnfavorite : copy.miniAppsFavorite}
                  onclick={(event) => toggleFavorite(event, app)}
                >
                  {#if quickAccess.favoriteIds.includes(app.id)}<Star size={14} aria-hidden="true" />{:else}<StarOff size={14} aria-hidden="true" />{/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        {#if favoriteApps.length > 0}
          <section class="miniapps-quick-group">
            <h3>{copy.miniAppsFavorites}</h3>
            <div class="miniapps-quick-list" role="list" aria-label={copy.miniAppsFavorites}>
              {#each favoriteApps as app (app.id)}
                <div class="miniapps-quick-row" role="listitem" aria-label={app.name}>
                  <button class="miniapps-quick-open" type="button" onclick={() => openApp(app)}>
                    <MiniAppIcon src={app.iconDataUri} label={app.name} size="list" />
                    <span class="miniapps-quick-name"><strong>{app.name}</strong></span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                  <button type="button" class="miniapps-quick-favorite active" aria-label={copy.miniAppsUnfavorite} title={copy.miniAppsUnfavorite} onclick={(event) => toggleFavorite(event, app)}>
                    <Star size={14} aria-hidden="true" />
                  </button>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if recentApps.length > 0}
          <section class="miniapps-quick-group">
            <h3>{copy.miniAppsRecent}</h3>
            <div class="miniapps-quick-list" role="list" aria-label={copy.miniAppsRecent}>
              {#each recentApps as app (app.id)}
                <div class="miniapps-quick-row" role="listitem" aria-label={app.name}>
                  <button class="miniapps-quick-open" type="button" onclick={() => openApp(app)}>
                    <MiniAppIcon src={app.iconDataUri} label={app.name} size="list" />
                    <span class="miniapps-quick-name"><strong>{app.name}</strong></span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                  <button type="button" class="miniapps-quick-favorite" aria-label={copy.miniAppsFavorite} title={copy.miniAppsFavorite} onclick={(event) => toggleFavorite(event, app)}>
                    <StarOff size={14} aria-hidden="true" />
                  </button>
                </div>
              {/each}
            </div>
          </section>
        {:else if favoriteApps.length === 0}
          <section class="miniapps-quick-group">
            <h3>{copy.miniAppsAll}</h3>
            <div class="miniapps-quick-list" role="list" aria-label={copy.miniAppsAll}>
              {#each availableApps as app (app.id)}
                <div class="miniapps-quick-row" role="listitem" aria-label={app.name}>
                  <button class="miniapps-quick-open" type="button" onclick={() => openApp(app)}>
                    <MiniAppIcon src={app.iconDataUri} label={app.name} size="list" />
                    <span class="miniapps-quick-name"><strong>{app.name}</strong></span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                  <button type="button" class="miniapps-quick-favorite" aria-label={copy.miniAppsFavorite} title={copy.miniAppsFavorite} onclick={(event) => toggleFavorite(event, app)}>
                    <StarOff size={14} aria-hidden="true" />
                  </button>
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/if}

      <button type="button" class="miniapps-quick-all" onclick={() => { closeMenu(false); onOpenLaunchpad(); }}>
        <span>{copy.miniAppsAll}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>

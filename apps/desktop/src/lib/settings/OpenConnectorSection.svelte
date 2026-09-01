<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import Refresh from "reicon-svelte/icons/Refresh";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import { invoke } from "@tauri-apps/api/core";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import MultiSelectControl from "../components/ui/MultiSelectControl.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { session } from "../stores/session.svelte";
  import { loadOpenConnector, openConnectorStore, refreshOpenConnector, revealOpenConnectorToken, saveOpenConnector } from "../stores/openConnector.svelte";

  let query = $state("");
  let statusFilter = $state("all");
  let categoryFilters = $state<string[]>([]);
  let tokenVisible = $state(false);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== openConnectorStore.endpoint) void loadOpenConnector(session.endpoint);
  });

  const connectionsByService = $derived.by(() => {
    const map = new Map<string, NonNullable<typeof openConnectorStore.summary>["connections"]>();
    for (const connection of openConnectorStore.summary?.connections ?? []) map.set(connection.service, [...(map.get(connection.service) ?? []), connection]);
    return map;
  });
  const categories = $derived([...new Set((openConnectorStore.summary?.providers ?? []).flatMap((provider) => provider.categories))].sort());
  const categoryCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const provider of openConnectorStore.summary?.providers ?? []) {
      for (const category of provider.categories) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  });
  const visibleProviders = $derived((openConnectorStore.summary?.providers ?? []).filter((provider) => {
    const needle = query.trim().toLocaleLowerCase();
    const connected = (connectionsByService.get(provider.service)?.length ?? 0) > 0;
    if (needle && !`${provider.displayName} ${provider.service} ${provider.description}`.toLocaleLowerCase().includes(needle)) return false;
    if (statusFilter === "connected" && !connected) return false;
    if (statusFilter === "available" && connected) return false;
    if (categoryFilters.length > 0 && !provider.categories.some((category) => categoryFilters.includes(category))) return false;
    return true;
  }));
  function stateLabel(): string {
    const state = openConnectorStore.summary?.state;
    if (state === "ready") return session.text.openConnectorReady;
    if (state === "error") return session.text.openConnectorError;
    if (state === "unconfigured") return session.text.openConnectorNeedsToken;
    return session.text.openConnectorDisabled;
  }

  async function openUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    if ("__TAURI_INTERNALS__" in window) await invoke("open_external_url", { url: parsed.href });
    else window.open(parsed.href, "_blank", "noopener,noreferrer");
  }

  function providerUrl(service: string): string {
    const root = (openConnectorStore.summary?.config.consoleUrl || openConnectorStore.draft.consoleUrl).replace(/\/+$/, "");
    return `${root}/${encodeURIComponent(service)}`;
  }

  async function toggleTokenVisibility(): Promise<void> {
    if (tokenVisible) {
      tokenVisible = false;
      return;
    }
    if (!openConnectorStore.draft.runtimeToken && openConnectorStore.summary?.config.tokenConfigured) {
      if (!await revealOpenConnectorToken()) return;
    }
    tokenVisible = true;
  }
</script>

{#if !session.serviceReady || openConnectorStore.loading || !openConnectorStore.summary}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="connector-overview" data-state={openConnectorStore.summary.state}>
    <div class="connector-overview-copy">
      <span class="status-badge" data-state={openConnectorStore.summary.state === "ready" ? "ready" : openConnectorStore.summary.state === "error" ? "error" : "disconnected"}>{stateLabel()}</span>
      <p>{session.text.openConnectorOverview}</p>
    </div>
    <button class="secondary-button" type="button" onclick={() => void refreshOpenConnector()} disabled={openConnectorStore.loading}><Refresh size={16} aria-hidden="true" />{session.text.openConnectorRefresh}</button>
  </div>

  <details class="settings-card connector-config-panel">
    <summary>
      <div class="profile-info"><strong>{session.text.openConnectorConfiguration}</strong><p>{openConnectorStore.summary.config.baseUrl}</p></div>
      <span class="connector-config-summary-state"><span class="status-badge" data-state={openConnectorStore.summary.config.enabled ? "ready" : "disconnected"}>{openConnectorStore.summary.config.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span><AngleDown size={12} aria-hidden="true" /></span>
    </summary>
    <div class="connector-config-body">
      <div class="settings-row">
        <div class="profile-info"><strong>{session.text.openConnectorEnabled}</strong><p>{session.text.openConnectorEnabledHint}</p></div>
        <IosSwitch checked={openConnectorStore.draft.enabled} ariaLabel={session.text.openConnectorEnabled} onCheckedChange={(enabled) => (openConnectorStore.draft.enabled = enabled)} />
      </div>
      <div class="settings-form connector-config-form">
        <label class="settings-field settings-field-wide"><span>{session.text.openConnectorBaseUrl}</span><input bind:value={openConnectorStore.draft.baseUrl} autocomplete="url" spellcheck="false" /></label>
        <label class="settings-field settings-field-wide"><span>{session.text.openConnectorConsoleUrl}</span><input bind:value={openConnectorStore.draft.consoleUrl} autocomplete="url" spellcheck="false" /></label>
        <label class="settings-field settings-field-wide"><span>{session.text.openConnectorToken}</span><div class="secret-input"><input type={tokenVisible ? "text" : "password"} bind:value={openConnectorStore.draft.runtimeToken} placeholder={openConnectorStore.summary.config.tokenConfigured ? session.text.channelSecretConfigured : "oct_…"} autocomplete="new-password" spellcheck="false" /><button class="secret-reveal" type="button" aria-label={tokenVisible ? session.text.openConnectorHideToken : session.text.openConnectorShowToken} title={tokenVisible ? session.text.openConnectorHideToken : session.text.openConnectorShowToken} onclick={(event) => { event.preventDefault(); void toggleTokenVisibility(); }}>{#if tokenVisible}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}</button></div>
          {#if openConnectorStore.summary.config.tokenConfigured}<label class="inline-check"><input type="checkbox" bind:checked={openConnectorStore.draft.clearRuntimeToken} /> {session.text.openConnectorClearToken}</label>{/if}
        </label>
      </div>
    </div>
  </details>

  {#if openConnectorStore.summary.state === "ready"}
    <div class="connector-catalog">
      <div class="connector-catalog-head">
        <div><strong>{session.text.openConnectorCatalog}</strong><p>{session.text.openConnectorCatalogHint.replace("{count}", String(openConnectorStore.summary.providers.length)).replace("{connected}", String(connectionsByService.size))}</p></div>
        <button class="secondary-button" type="button" onclick={() => void openUrl(openConnectorStore.summary!.config.consoleUrl)}>{session.text.openConnectorOpenConsole}<SquareArrowUp size={16} aria-hidden="true" /></button>
      </div>
      <div class="connector-filter-toolbar">
        <SearchField value={query} placeholder={session.text.openConnectorSearch} label={session.text.openConnectorSearch} onInput={(value) => (query = value)} />
        <SelectControl value={statusFilter} ariaLabel={session.text.openConnectorStatusFilter} options={[{ value: "all", label: session.text.openConnectorAll }, { value: "connected", label: session.text.openConnectorConnected }, { value: "available", label: session.text.openConnectorAvailable }]} onChange={(value) => (statusFilter = value)} />
        <MultiSelectControl value={categoryFilters} ariaLabel={session.text.openConnectorCategoryFilter} emptyLabel={session.text.openConnectorAllCategories} selectedLabel={(count) => session.text.openConnectorSelectedCategories.replace("{count}", String(count))} options={categories.map((category) => ({ value: category, label: `${category} · ${categoryCounts.get(category) ?? 0}` }))} onChange={(value) => (categoryFilters = value)} />
      </div>
      {#if visibleProviders.length === 0}
        <EmptyState title={session.text.openConnectorNoResults} description={session.text.openConnectorNoResultsHint} icon="magnifying-glass" />
      {:else}
        <div class="connector-grid">
          {#each visibleProviders as provider (provider.service)}
            {@const connections = connectionsByService.get(provider.service) ?? []}
            <article class="connector-card">
              {#if provider.homepageUrl}
                <button class="connector-card-head connector-provider-link" type="button" title={provider.homepageUrl} aria-label={session.text.openConnectorOpenHomepage.replace("{name}", provider.displayName)} onclick={() => void openUrl(provider.homepageUrl)}>
                  <div class="connector-icon">
                    <span>{provider.displayName.slice(0, 1).toUpperCase()}</span>
                    {#if provider.iconUrl}<img src={provider.iconUrl} alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => event.currentTarget.remove()} />{/if}
                  </div>
                  <div class="connector-card-title"><strong><span>{provider.displayName}</span><SquareArrowUp size={14} aria-hidden="true" /></strong><small>{provider.service}</small></div>
                </button>
              {:else}
                <div class="connector-card-head">
                  <div class="connector-icon">
                    <span>{provider.displayName.slice(0, 1).toUpperCase()}</span>
                    {#if provider.iconUrl}<img src={provider.iconUrl} alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => event.currentTarget.remove()} />{/if}
                  </div>
                  <div class="connector-card-title"><strong><span>{provider.displayName}</span></strong><small>{provider.service}</small></div>
                </div>
              {/if}
              <div class="connector-card-actions">
                <span class="status-badge" data-state={connections.length ? "ready" : "disconnected"}>{connections.length ? session.text.openConnectorConnected : session.text.openConnectorAvailable}</span>
                <button class="connector-card-action" type="button" aria-label={connections.length ? session.text.openConnectorManage : session.text.openConnectorConnect} onclick={() => void openUrl(providerUrl(provider.service))}><span>{connections.length ? session.text.openConnectorManage : session.text.openConnectorConnect}</span><ArrowRight size={14} aria-hidden="true" /></button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {:else if openConnectorStore.summary.error}
    <div class="settings-card"><div class="settings-row"><div class="profile-info"><strong>{session.text.openConnectorError}</strong><p class="settings-error-copy">{openConnectorStore.summary.error}</p></div></div></div>
  {/if}

  <footer class="settings-footbar">
    <span class="settings-footbar-label" aria-live="polite">{openConnectorStore.message || session.text.openConnectorSaveHint}</span>
    <div class="settings-footbar-actions"><button class="primary-button" type="button" onclick={() => void saveOpenConnector()} disabled={openConnectorStore.saving || !openConnectorStore.draft.baseUrl.trim()}>{openConnectorStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></div>
  </footer>
{/if}

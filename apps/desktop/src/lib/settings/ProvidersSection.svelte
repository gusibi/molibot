<script lang="ts">
  import type { DesktopProviderItem, DesktopProvidersSummary, DesktopProviderUpdateRequest } from "@molibot/desktop-contract";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { humanizeProviderName } from "../presentation";
  import { session } from "../stores/session.svelte";
  import {
    providersStore,
    PROVIDER_MODEL_ROLES,
    PROVIDER_MODEL_TAGS,
    PROVIDER_THINKING_FORMATS,
    addProviderModel,
    beginNewProvider,
    beginProviderEdit,
    closeProviderEdit,
    defaultProviderPath,
    discoverProviderModels,
    loadProviders,
    onProviderOverlayKeydown,
    removeProvider,
    removeProviderModel,
    saveProviderEdit,
    saveProviderGlobals,
    setProviderAsDefault,
    toggleProviderModelRole,
    toggleProviderModelTag,
    updateProviderEdit,
    updateProviderModel,
    verifyProvider,
    verifyProviderModel
  } from "../stores/providers.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== providersStore.endpoint) {
      void loadProviders(session.endpoint);
    }
  });

  let hasEditBaseUrl = $derived(!!providersStore.providerEdit?.baseUrl.trim());
  let hasEditApiKey = $derived(
    !!(
      providersStore.editApiKey.trim() ||
      (!providersStore.providerEdit?.isNew &&
        providersStore.providers?.customProviders.find((item) => item.id === providersStore.providerEdit?.id)?.hasApiKey &&
        !providersStore.editClearApiKey)
    )
  );
  let canDiscoverModels = $derived(hasEditBaseUrl && hasEditApiKey && !providersStore.discovering);

  let providerSearch = $state("");
  let providerTab = $state<"builtin" | "custom">("builtin");
  let providerSortActive = $state(true);
  let selectedProviderId = $state("");
  let pendingDeleteProviderId = $state("");
  let providerDeleteDialog = $state<HTMLElement | null>(null);
  type ProviderBrowserItem =
    | { kind: "builtin"; provider: DesktopProvidersSummary["builtinProviders"][number]; index: number }
    | { kind: "custom"; provider: DesktopProviderItem; index: number };

  $effect(() => {
    if (pendingDeleteProviderId) queueMicrotask(() => providerDeleteDialog?.focus());
  });

  function providerProtocolLabel(protocol: string): string {
    return protocol === "openai-compatible" ? session.text.protocolOpenaiCompatible : protocol;
  }

  let visibleProvidersList = $derived.by(() => {
    if (!providersStore.providers) return [];
    let list: ProviderBrowserItem[] = providerTab === "builtin"
      ? providersStore.providers.builtinProviders.map((provider, index) => ({ kind: "builtin" as const, provider, index }))
      : providersStore.providers.customProviders.map((provider, index) => ({ kind: "custom" as const, provider, index }));

    // 2. Filter by search query
    const query = providerSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => item.provider.name.toLowerCase().includes(query) || item.provider.id.toLowerCase().includes(query));
    }

    // 3. Sort active first if toggled
    if (providerSortActive) {
      list = [...list].sort((a, b) => {
        const aVal = a.kind === "builtin" || a.provider.enabled ? 1 : 0;
        const bVal = b.kind === "builtin" || b.provider.enabled ? 1 : 0;
        if (aVal !== bVal) return bVal - aVal;
        return a.index - b.index;
      });
    }

    return list;
  });

  let selectedProvider = $derived(
    visibleProvidersList.find((item) => item.provider.id === selectedProviderId) ??
      visibleProvidersList[0] ??
      null
  );

  $effect(() => {
    const firstVisibleId = visibleProvidersList[0]?.provider.id ?? "";
    if (!visibleProvidersList.some((item) => item.provider.id === selectedProviderId)) {
      selectedProviderId = firstVisibleId;
    }
  });

  function providerLabel(name: string, id: string): string {
    return humanizeProviderName(name, id).label;
  }

  function providerModelCount(item: (typeof visibleProvidersList)[number]): number {
    return item.kind === "builtin" ? item.provider.models.length : item.provider.modelCount;
  }

  function providerEnabled(item: (typeof visibleProvidersList)[number]): boolean {
    return item.kind === "builtin" || item.provider.enabled;
  }

  let modelSearch = $state("");
  let modelTab = $state<"builtin" | "custom">("builtin");
  let sortActiveFirst = $state(true);

  let lastEditProviderId = "";
  $effect(() => {
    const editProviderId = providersStore.providerEdit?.id ?? "";
    if (editProviderId !== lastEditProviderId) {
      lastEditProviderId = editProviderId;
      if (providersStore.providerEdit) {
        const hasBuiltin = providersStore.providers?.builtinProviders.some((p) => p.id === editProviderId) ?? false;
        modelTab = hasBuiltin ? "builtin" : "custom";
        modelSearch = "";
      }
    }
  });

  let visibleModelsList = $derived.by(() => {
    if (!providersStore.providerEdit) return [];
    const editProviderId = providersStore.providerEdit.id;
    const builtinModels = providersStore.providers?.builtinProviders.find((p) => p.id === editProviderId)?.models ?? [];

    let list = providersStore.providerEdit.models.map((model, index) => ({ model, index }));

    // 1. Filter by Tab
    list = list.filter((item) => {
      const isBuiltin = builtinModels.includes(item.model.id);
      return modelTab === "builtin" ? isBuiltin : !isBuiltin;
    });

    // 2. Filter by search query
    const query = modelSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => item.model.id.toLowerCase().includes(query));
    }

    // 3. Sort active/enabled first if enabled
    if (sortActiveFirst) {
      list = [...list].sort((a, b) => {
        const aVal = a.model.enabled ? 1 : 0;
        const bVal = b.model.enabled ? 1 : 0;
        if (aVal !== bVal) return bVal - aVal;
        return a.index - b.index;
      });
    }
    return list;
  });
</script>

        {#if !session.serviceReady}
          <SettingGroup><EmptyState title={session.text.providersUnavailable} icon="cloud-slash" /></SettingGroup>
        {:else if providersStore.loading || !providersStore.providers}
          <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
        {:else}
          <SettingGroup title={session.text.providerGlobalSettings}>
            <SettingRow title={session.text.providersMode}>
              <SelectControl
                value={providersStore.globals.providerMode}
                ariaLabel={session.text.providersMode}
                options={[
                  { value: "pi", label: session.text.providersModePi },
                  { value: "custom", label: session.text.providersModeCustom }
                ]}
                onChange={(value) => {
                  providersStore.globals = { ...providersStore.globals, providerMode: value === "custom" ? "custom" : "pi" };
                  providersStore.globalsDirty = true;
                }}
              />
            </SettingRow>
            <SettingRow title={session.text.providersPiProvider}>
              <SelectControl
                value={providersStore.globals.piProvider}
                ariaLabel={session.text.providersPiProvider}
                options={[
                  { value: "", label: "—" },
                  ...providersStore.providers.builtinProviders.map((provider) => ({
                    value: provider.id,
                    label: providerLabel(provider.name, provider.id)
                  }))
                ]}
                technicalId={providersStore.globals.piProvider}
                technicalLabel={session.text.technicalDetails}
                onChange={(piProvider) => {
                  const piModel = providersStore.providers?.builtinProviders.find((provider) => provider.id === piProvider)?.models[0] ?? "";
                  providersStore.globals = { ...providersStore.globals, piProvider, piModel };
                  providersStore.globalsDirty = true;
                }}
              />
            </SettingRow>
            <SettingRow title={session.text.providersPiModel}>
              <SelectControl
                value={providersStore.globals.piModel}
                ariaLabel={session.text.providersPiModel}
                options={[
                  { value: "", label: "—" },
                  ...(providersStore.providers.builtinProviders.find((provider) => provider.id === providersStore.globals.piProvider)?.models ?? []).map((model) => ({
                    value: model,
                    label: humanizeProviderName(model.split("/").at(-1) ?? model, model).label
                  }))
                ]}
                technicalId={providersStore.globals.piModel}
                technicalLabel={session.text.technicalDetails}
                onChange={(piModel) => {
                  providersStore.globals = { ...providersStore.globals, piModel };
                  providersStore.globalsDirty = true;
                }}
              />
            </SettingRow>
            <SettingRow title={session.text.providerSetDefault}>
              <SelectControl
                value={providersStore.globals.defaultCustomProviderId}
                ariaLabel={session.text.providerSetDefault}
                options={[
                  { value: "", label: "—" },
                  ...providersStore.providers.customProviders.filter((provider) => provider.enabled).map((provider) => ({
                    value: provider.id,
                    label: providerLabel(provider.name, provider.id)
                  }))
                ]}
                onChange={(defaultCustomProviderId) => {
                  providersStore.globals = { ...providersStore.globals, defaultCustomProviderId };
                  providersStore.globalsDirty = true;
                }}
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title={session.text.providerListTitle} description={session.text.providerSelfHostedHint} contentClass="provider-browser">
            <button slot="action" class="secondary-button" type="button" disabled={providersStore.providerEdit !== null} onclick={beginNewProvider}>
              <i class="ph ph-plus" aria-hidden="true"></i>{session.text.providerAdd}
            </button>
            <div class="provider-browser-toolbar">
              <SearchField
                value={providerSearch}
                label={session.text.providersFilterTitle}
                placeholder={session.text.providersFilterTitle}
                onInput={(value) => (providerSearch = value)}
              />
              <div class="model-tabs-wrap" role="tablist" aria-label={session.text.providersCategoryTitle}>
                <button type="button" role="tab" aria-selected={providerTab === "builtin"} class="model-tab-button" class:active={providerTab === "builtin"} onclick={() => (providerTab = "builtin")}>{session.text.providerBuiltinTitle}</button>
                <button type="button" role="tab" aria-selected={providerTab === "custom"} class="model-tab-button" class:active={providerTab === "custom"} onclick={() => (providerTab = "custom")}>{session.text.providerSelfHostedTitle}</button>
              </div>
              <button type="button" class="secondary-button sort-toggle-button" class:active={providerSortActive} aria-pressed={providerSortActive} onclick={() => (providerSortActive = !providerSortActive)}>
                <i class="ph ph-sort-descending" aria-hidden="true"></i>{session.text.modelSortActive}
              </button>
            </div>

            {#if visibleProvidersList.length === 0}
              <EmptyState title={session.text.providersEmpty} icon="plugs" />
            {:else}
              <div class="provider-browser-layout">
                <div class="provider-browser-list" role="listbox" aria-label={session.text.providerListTitle}>
                  {#each visibleProvidersList as item (item.provider.id)}
                    {@const provider = item.provider}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedProvider?.provider.id === provider.id}
                      class="provider-browser-row"
                      class:selected={selectedProvider?.provider.id === provider.id}
                      onclick={() => (selectedProviderId = provider.id)}
                    >
                      <span class="provider-row-copy">
                        <strong>{providerLabel(provider.name, provider.id)}</strong>
                        <small>{providerModelCount(item)} {session.text.providerModels}</small>
                      </span>
                      <StatusBadge
                        label={item.kind === "builtin" ? session.text.providerBuiltinTitle : providerEnabled(item) ? session.text.providerEnabled : session.text.providerDisabled}
                        state={providerEnabled(item) ? "ready" : "disconnected"}
                      />
                    </button>
                  {/each}
                </div>

                {#if selectedProvider?.kind === "builtin"}
                  {@const provider = selectedProvider.provider}
                  <section class="provider-browser-detail" aria-label={providerLabel(provider.name, provider.id)}>
                    <header class="provider-detail-head">
                      <div>
                        <h4>{providerLabel(provider.name, provider.id)}</h4>
                        <StatusBadge label={provider.id === providersStore.globals.piProvider ? session.text.providersDefault : session.text.providerBuiltinTitle} state="ready" />
                      </div>
                    </header>
                    <dl class="provider-summary">
                      <div><dt>{session.text.providerModels}</dt><dd>{provider.models.length}</dd></div>
                      <div><dt>{session.text.providerDefaultModel}</dt><dd>{provider.models[0] ? humanizeProviderName(provider.models[0].split("/").at(-1) ?? provider.models[0], provider.models[0]).label : "—"}</dd></div>
                    </dl>
                    <details class="provider-technical-details technical-detail">
                      <summary>{session.text.technicalDetails}</summary>
                      <dl>
                        <div><dt>{session.text.providerId}</dt><dd><code>{provider.id}</code></dd></div>
                        <div><dt>{session.text.providerProtocol}</dt><dd>Pi</dd></div>
                      </dl>
                    </details>
                  </section>
                {:else if selectedProvider?.kind === "custom"}
                  {@const provider = selectedProvider.provider}
                  <section class="provider-browser-detail" aria-label={providerLabel(provider.name, provider.id)}>
                    <header class="provider-detail-head">
                      <div><h4>{providerLabel(provider.name, provider.id)}</h4><StatusBadge label={provider.isDefault ? session.text.providersDefault : provider.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={provider.enabled ? "ready" : "disconnected"} /></div>
                      <OverflowMenu label={session.text.more}><button role="menuitem" type="button" disabled={providersStore.providerEdit !== null} onclick={() => beginProviderEdit(provider.id)}><i class="ph ph-pencil-simple" aria-hidden="true"></i>{session.text.providerEdit}</button><button role="menuitem" type="button" disabled={provider.isDefault || providersStore.saving} onclick={() => void setProviderAsDefault(provider.id)}><i class="ph ph-star" aria-hidden="true"></i>{session.text.providersSetDefault}</button><button role="menuitem" type="button" disabled={providersStore.testingId !== null || !provider.hasApiKey} onclick={() => void verifyProvider(provider.id)}><i class="ph ph-plugs-connected" aria-hidden="true"></i>{providersStore.testingId === provider.id ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button><button role="menuitem" class="danger-action" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = provider.id)}><i class="ph ph-trash" aria-hidden="true"></i>{session.text.providerDelete}</button></OverflowMenu>
                    </header>
                    <dl class="provider-summary"><div><dt>{session.text.providerModels}</dt><dd>{provider.modelCount}</dd></div><div><dt>{session.text.providerDefaultModel}</dt><dd>{provider.defaultModel ? humanizeProviderName(provider.defaultModel.split("/").at(-1) ?? provider.defaultModel, provider.defaultModel).label : "—"}</dd></div><div><dt>{session.text.providerApiKey}</dt><dd>{provider.hasApiKey ? session.text.providerApiKeyConfigured : session.text.providerApiKeyMissing}</dd></div></dl>
                    <details class="provider-technical-details technical-detail"><summary>{session.text.technicalDetails}</summary><dl><div><dt>{session.text.providerId}</dt><dd><code>{provider.id}</code></dd></div><div><dt>{session.text.providerProtocol}</dt><dd>{providerProtocolLabel(provider.protocol)}</dd></div><div><dt>Base URL</dt><dd><code>{provider.baseUrl}</code></dd></div></dl></details>
                    <div class="provider-detail-actions">
                      <button class="secondary-button" type="button" disabled={providersStore.providerEdit !== null} onclick={() => beginProviderEdit(provider.id)}>{session.text.providerEdit}</button>
                      <button class="secondary-button" type="button" disabled={providersStore.testingId !== null || !provider.hasApiKey} onclick={() => void verifyProvider(provider.id)}>{providersStore.testingId === provider.id ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button>
                    </div>
                  </section>
                {/if}
              </div>
            {/if}
          </SettingGroup>
          {#if providersStore.providerEdit}
            <div class="modal-overlay provider-modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={providersStore.providerEdit.isNew ? session.text.providerCreateTitle : session.text.providerEditTitle} onclick={(event) => { if (event.target === event.currentTarget && !providersStore.saving) closeProviderEdit(); }} onkeydown={onProviderOverlayKeydown}>
            <form id="desktop-provider-edit-form" class="modal-card provider-modal-card" onsubmit={(event) => { event.preventDefault(); void saveProviderEdit(); }}>
              <header class="modal-head provider-modal-head">
                <div><strong>{providersStore.providerEdit.isNew ? session.text.providerCreateTitle : session.text.providerEditTitle}</strong><p>{session.text.providerSelfHostedHint}</p></div>
                <button class="modal-close" type="button" aria-label={session.text.cancel} disabled={providersStore.saving} onclick={closeProviderEdit}><i class="ph ph-x"></i></button>
              </header>
              <div class="modal-body provider-modal-body">
              <div class="settings-form provider-editor-grid">
                <label class="settings-field"><span>{session.text.providerId}</span><input value={providersStore.providerEdit.id} disabled={!providersStore.providerEdit.isNew} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.onboardingProviderName}</span><input value={providersStore.providerEdit.name} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.onboardingProviderProtocol}</span><select value={providersStore.providerEdit.protocol} onchange={(event) => updateProviderEdit((draft) => { const protocol = (event.currentTarget as HTMLSelectElement).value === "anthropic" ? "anthropic" : "openai-compatible"; const oldDefaultPath = defaultProviderPath(draft.protocol); return { ...draft, protocol, path: !draft.path.trim() || draft.path === oldDefaultPath ? defaultProviderPath(protocol) : draft.path }; })}><option value="openai-compatible">{session.text.protocolOpenaiCompatible}</option><option value="anthropic">{session.text.protocolAnthropic}</option></select></label>
                <label class="settings-field"><span>{session.text.onboardingProviderBaseUrl}</span><input value={providersStore.providerEdit.baseUrl} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, baseUrl: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.providerPath}</span><input value={providersStore.providerEdit.path} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, path: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{providersStore.providerEdit.isNew ? session.text.onboardingProviderApiKey : session.text.providerReplaceApiKey}</span><input type="password" bind:value={providersStore.editApiKey} autocomplete="new-password" />{#if providersStore.providerEdit.isNew}<small>{session.text.providerCreateKeyHint}</small>{/if}</label>
                <label class="settings-field"><span>{session.text.providerDefaultModel}</span><select value={providersStore.providerEdit.defaultModel} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, defaultModel: (event.currentTarget as HTMLSelectElement).value }))}><option value="">—</option>{#each providersStore.providerEdit.models as model, i (`${i}:${model.id}`)}<option value={model.id}>{model.id || session.text.providerModelId}</option>{/each}</select></label>
                <label class="settings-field"><span>{session.text.providerThinkingSupport}</span><select value={providersStore.providerEdit.supportsThinking === null ? "auto" : providersStore.providerEdit.supportsThinking ? "enabled" : "disabled"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateProviderEdit((draft) => ({ ...draft, supportsThinking: value === "auto" ? null : value === "enabled" })); }}><option value="auto">{session.text.providerThinkingAuto}</option><option value="enabled">{session.text.providerThinkingEnabled}</option><option value="disabled">{session.text.providerThinkingDisabled}</option></select></label>
                <label class="settings-field"><span>{session.text.providerThinkingFormat}</span><select value={providersStore.providerEdit.thinkingFormat ?? ""} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, thinkingFormat: ((event.currentTarget as HTMLSelectElement).value || null) as DesktopProviderUpdateRequest["thinkingFormat"] }))}><option value="">{session.text.providerThinkingAuto}</option>{#each PROVIDER_THINKING_FORMATS as format (format)}<option value={format}>{format}</option>{/each}</select></label>
              </div>
              <div class="provider-inline-options">
                <div class="inline-switch-row"><span>{session.text.providerEnabledLabel}</span><button class:active={providersStore.providerEdit.enabled} class="switch" type="button" role="switch" aria-label={session.text.providerEnabledLabel} aria-checked={providersStore.providerEdit.enabled} onclick={() => updateProviderEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div>
                {#if !providersStore.providerEdit.isNew}<label><input type="checkbox" bind:checked={providersStore.editClearApiKey} /> {session.text.providerClearApiKey}</label>{/if}
              </div>
              <p class="settings-group-title provider-subtitle">{session.text.providerReasoningMap}</p>
              <div class="settings-form provider-reasoning-grid">
                <label class="settings-field"><span>{session.text.providerReasoningLow}</span><input value={providersStore.providerEdit.reasoningEffortMap.low ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, low: (event.currentTarget as HTMLInputElement).value } }))} /></label>
                <label class="settings-field"><span>{session.text.providerReasoningMedium}</span><input value={providersStore.providerEdit.reasoningEffortMap.medium ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, medium: (event.currentTarget as HTMLInputElement).value } }))} /></label>
                <label class="settings-field"><span>{session.text.providerReasoningHigh}</span><input value={providersStore.providerEdit.reasoningEffortMap.high ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, high: (event.currentTarget as HTMLInputElement).value } }))} /></label>
              </div>
              <div class="provider-editor-toolbar provider-model-toolbar">
                <div><strong>{session.text.providerCustomModelsTitle}</strong><p>{session.text.providerCustomModelsHint}</p></div>
                <div class="settings-row-actions">
                  <button class="secondary-button" type="button" onclick={() => addProviderModel()}>{session.text.providerAddModel}</button>
                  <button class="secondary-button" type="button" disabled={!canDiscoverModels} onclick={() => void discoverProviderModels()}>{providersStore.discovering ? session.text.loading : session.text.providerPullModels}</button>
                </div>
              </div>
              {#if providersStore.discoveredModels.length > 0}
                <div class="provider-discovered-models">
                  {#each providersStore.discoveredModels as modelId (modelId)}
                    <button type="button" class="model-chip" disabled={providersStore.providerEdit.models.some((model) => model.id === modelId)} onclick={() => addProviderModel(modelId)}>+ {modelId}</button>
                  {/each}
                </div>
              {/if}
              <div class="provider-model-controls">
                <div class="model-controls-left">
                  <input
                    type="text"
                    class="row-input model-search-input"
                    placeholder={session.text.modelSearchPlaceholder}
                    bind:value={modelSearch}
                  />
                  <div class="model-tabs-wrap">
                    <button
                      type="button"
                      class="model-tab-button"
                      class:active={modelTab === "builtin"}
                      onclick={() => (modelTab = "builtin")}
                    >
                      {session.text.modelTabBuiltin}
                    </button>
                    <button
                      type="button"
                      class="model-tab-button"
                      class:active={modelTab === "custom"}
                      onclick={() => (modelTab = "custom")}
                    >
                      {session.text.modelTabCustom}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  class="secondary-button sort-toggle-button"
                  class:active={sortActiveFirst}
                  onclick={() => (sortActiveFirst = !sortActiveFirst)}
                >
                  {sortActiveFirst ? session.text.modelSortActive : session.text.modelSortDefault}
                </button>
              </div>
              <div class="provider-model-list">
                {#each visibleModelsList as item (item.index)}
                  {@const model = item.model}
                  {@const index = item.index}
                  <div class="provider-model-card">
                    <div class="provider-model-head">
                      <input class="row-input" value={model.id} placeholder={session.text.providerModelId} oninput={(event) => updateProviderModel(index, { id: (event.currentTarget as HTMLInputElement).value })} />
                      <input class="row-input context-input" type="number" min="1" value={model.contextWindow ?? ""} placeholder={session.text.providerModelContext} oninput={(event) => { const value = Number((event.currentTarget as HTMLInputElement).value); updateProviderModel(index, { contextWindow: Number.isFinite(value) && value > 0 ? value : undefined }); }} />
                      <button class:active={model.enabled} class="switch" type="button" role="switch" aria-label={session.text.providerModelEnabled} aria-checked={model.enabled} onclick={() => updateProviderModel(index, { enabled: !model.enabled })}><span></span></button>
                    </div>
                    <div class="provider-model-tags">
                      {#each PROVIDER_MODEL_TAGS as tag (tag)}
                        <button type="button" class:active={model.tags.includes(tag)} class="model-chip" onclick={() => toggleProviderModelTag(index, tag)}>{tag}</button>
                      {/each}
                    </div>
                    {#if Object.keys(model.verification ?? {}).length > 0}
                      <div class="provider-model-verify">
                        {#each PROVIDER_MODEL_TAGS as tag (tag)}
                          {#if model.verification?.[tag]}
                            <span class="model-chip verify-{model.verification[tag]}">{tag} · {model.verification[tag] === "passed" ? session.text.providerModelVerifyPassed : model.verification[tag] === "failed" ? session.text.providerModelVerifyFailed : session.text.providerModelVerifyUntested}</span>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                    <div class="provider-model-roles-row">
                      <span class="provider-model-roles-label">{session.text.providerModelRoles}</span>
                      <div class="provider-model-roles">
                        {#each PROVIDER_MODEL_ROLES as role (role)}
                          <button type="button" class:active={(model.supportedRoles ?? []).includes(role)} class="model-chip" onclick={() => toggleProviderModelRole(index, role)}>{role}</button>
                        {/each}
                      </div>
                    </div>
                    <div class="provider-model-actions">
                      <button class="secondary-button" type="button" disabled={providersStore.providerEdit.isNew || !model.id.trim() || providersStore.testingId !== null} title={providersStore.providerEdit.isNew ? session.text.providerSaveBeforeRemote : undefined} onclick={() => void verifyProviderModel(index)}>{providersStore.testingId === `${providersStore.providerEdit.id}:${model.id}` ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button>
                      <button class="secondary-button danger-action" type="button" onclick={() => removeProviderModel(index)}>{session.text.providerModelRemove}</button>
                    </div>
                  </div>
                {/each}
              </div>
              {#if providersStore.actionMessage}<p class:run-history-failed={providersStore.actionFailed} class="settings-action-message provider-modal-message">{providersStore.actionMessage}</p>{/if}
              </div>
              <footer class="provider-modal-foot">
                <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={closeProviderEdit}>{session.text.cancel}</button>
                <button class="primary-button" type="submit" disabled={providersStore.saving || !providersStore.providerEdit.id.trim() || !providersStore.providerEdit.name.trim() || !providersStore.providerEdit.baseUrl.trim() || (providersStore.providerEdit.isNew && !providersStore.editApiKey.trim())}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
              </footer>
            </form>
            </div>
          {/if}
          {#if providersStore.actionMessage && !providersStore.providerEdit}
            <p class:run-history-failed={providersStore.actionFailed} class="settings-action-message">{providersStore.actionMessage}</p>
          {/if}
        {/if}

{#if pendingDeleteProviderId}
  <div class="modal-overlay confirm-overlay" role="presentation" tabindex="-1" bind:this={providerDeleteDialog} onclick={(event) => { if (event.target === event.currentTarget && !providersStore.saving) pendingDeleteProviderId = ""; }} onkeydown={(event) => { if (event.key === "Escape" && !providersStore.saving) pendingDeleteProviderId = ""; }}>
    <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="provider-delete-title" aria-describedby="provider-delete-description">
      <h3 id="provider-delete-title">{session.text.providerDelete}</h3>
      <p id="provider-delete-description">{session.text.providerDeleteConfirm}</p>
      <div class="confirm-dialog-actions">
        <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = "")}>{session.text.cancel}</button>
        <button class="primary-button danger-button" type="button" disabled={providersStore.saving} onclick={async () => { const providerId = pendingDeleteProviderId; await removeProvider(providerId); pendingDeleteProviderId = ""; }}>{session.text.providerDelete}</button>
      </div>
    </div>
  </div>
{/if}

{#if providersStore.globalsDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={providersStore.saving} onclick={() => void saveProviderGlobals()}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.providerSaveGlobal}</button>
    </div>
  </footer>
{/if}

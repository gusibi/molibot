<script lang="ts">
  import {
    type DesktopProviderItem,
    type DesktopProviderModel,
    type DesktopProvidersSummary,
    type DesktopProviderUpdateRequest
  } from "@molibot/desktop-contract";
  import { invoke } from "@tauri-apps/api/core";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { humanizeProviderName } from "../presentation";
  import { session } from "../stores/session.svelte";
  import {
    beginProviderAuth,
    closeProviderAuth,
    loadProviderAuth,
    resetProviderAuthRequest,
    logoutProviderAuth,
    providerAuthIsTerminal,
    providerAuthStore,
    submitProviderAuthAnswer,
    verifyProviderAuth
  } from "../stores/providerAuth.svelte";
  import {
    providersStore,
    PROVIDER_MODEL_ROLES,
    PROVIDER_MODEL_TAGS,
    PROVIDER_THINKING_FORMATS,
    addProviderModel,
    beginBuiltinProviderEdit,
    beginNewProvider,
    beginProviderEdit,
    closeProviderEdit,
    defaultProviderPath,
    discoverProviderModels,
    loadProviders,
    removeProvider,
    removeProviderModel,
    saveProviderEdit,
    saveProviderGlobals,
    setProviderAsDefault,
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

  $effect(() => {
    if (session.serviceReady && session.endpoint) void loadProviderAuth();
    else resetProviderAuthRequest();
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
  let modelEditorIndex = $state<number | null>(null);
  let modelEditorDraft = $state<DesktopProviderModel | null>(null);
  let modelDiscoveryOpen = $state(false);
  let modelDiscoveryQuery = $state("");
  type ProviderBrowserItem =
    | { kind: "builtin"; provider: DesktopProvidersSummary["builtinProviders"][number]; index: number }
    | { kind: "custom"; provider: DesktopProviderItem; index: number };

  let builtinProviderIds = $derived(new Set(providersStore.providers?.builtinProviders.map((provider) => provider.id) ?? []));

  function providerProtocolLabel(protocol: string): string {
    return protocol === "openai-compatible" ? session.text.protocolOpenaiCompatible : protocol;
  }

  let visibleProvidersList = $derived.by(() => {
    if (!providersStore.providers) return [];
    let list: ProviderBrowserItem[] = providerTab === "builtin"
      ? providersStore.providers.builtinProviders.map((provider, index) => ({ kind: "builtin" as const, provider, index }))
      : providersStore.providers.customProviders.filter((provider) => !builtinProviderIds.has(provider.id)).map((provider, index) => ({ kind: "custom" as const, provider, index }));

    // 2. Filter by search query
    const query = providerSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => item.provider.name.toLowerCase().includes(query) || item.provider.id.toLowerCase().includes(query));
    }

    // 3. Sort active first if toggled
    if (providerSortActive) {
      list = [...list].sort((a, b) => {
        const aVal = providerEnabled(a) ? 1 : 0;
        const bVal = providerEnabled(b) ? 1 : 0;
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
  let selectedProviderAuth = $derived(
    selectedProvider?.kind === "builtin"
      ? providerAuthStore.providers.find((provider) => provider.id === selectedProvider.provider.id)
      : undefined
  );
  let selectedProviderAuthStatus = $derived(
    selectedProviderAuth?.credential
      ? session.text.providerAuthConnected
      : session.text.providerAuthNotConnected
  );
  let authCopiedCode = $state("");
  let selectedProviderVerification = $derived(
    selectedProviderAuth ? providerAuthStore.verified[selectedProviderAuth.id] : undefined
  );

  async function openProviderAuthUrl(value: string): Promise<void> {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported URL scheme");
      if ("__TAURI_INTERNALS__" in window) {
        await invoke("open_external_url", { url: url.href });
      } else {
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
    } catch (cause) {
      providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function copyProviderAuthCode(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      // Keyed on the code itself: a device code that gets refreshed mid-flow
      // must not inherit the previous code's "copied" state.
      authCopiedCode = value;
      window.setTimeout(() => {
        if (authCopiedCode === value) authCopiedCode = "";
      }, 1800);
    } catch (cause) {
      providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

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
    if (item.kind === "custom") return item.provider.enabled;
    return providersStore.providers?.customProviders.find((provider) => provider.id === item.provider.id)?.enabled === true;
  }

  function providerInventory(item: ProviderBrowserItem): DesktopProviderModel[] {
    if (item.kind === "custom") return item.provider.models;
    const saved = providersStore.providers?.customProviders.find((provider) => provider.id === item.provider.id);
    return saved?.models ?? item.provider.models.map((id) => ({
      id,
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    }));
  }

  function beginBrowserProviderEdit(item: ProviderBrowserItem): void {
    if (item.kind === "builtin") beginBuiltinProviderEdit(item.provider);
    else beginProviderEdit(item.provider.id);
  }

  function openBrowserModelEditor(item: ProviderBrowserItem, index: number): void {
    beginBrowserProviderEdit(item);
    const model = providersStore.providerEdit?.models[index];
    if (!model) return;
    modelEditorIndex = index;
    modelEditorDraft = { ...model, tags: [...model.tags], supportedRoles: [...(model.supportedRoles ?? [])], verification: { ...(model.verification ?? {}) } };
  }

  let modelSearch = $state("");
  let sortActiveFirst = $state(true);

  let lastEditProviderId = "";
  $effect(() => {
    const editProviderId = providersStore.providerEdit?.id ?? "";
    if (editProviderId !== lastEditProviderId) {
      lastEditProviderId = editProviderId;
      modelSearch = "";
    }
  });

  let editModelIds = $derived(
    new Set((providersStore.providerEdit?.models ?? []).map((model) => model.id.trim()).filter(Boolean))
  );

  // Discovered models still available to add, filtered inside the focused dialog.
  let visibleDiscoveredModels = $derived.by(() => {
    const query = modelDiscoveryQuery.trim().toLowerCase();
    return providersStore.discoveredModels
      .filter((id) => !query || id.toLowerCase().includes(query));
  });

  function addDiscoveredModel(id: string): void {
    const value = id.trim();
    if (!value || editModelIds.has(value)) return;
    addProviderModel(value);
  }

  function openNewModelEditor(): void {
    modelEditorIndex = null;
    modelEditorDraft = {
      id: "",
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    };
  }

  function openProviderEditModel(index: number): void {
    const model = providersStore.providerEdit?.models[index];
    if (!model) return;
    modelEditorIndex = index;
    modelEditorDraft = { ...model, tags: [...model.tags], supportedRoles: [...(model.supportedRoles ?? [])], verification: { ...(model.verification ?? {}) } };
  }

  function closeModelEditor(): void {
    modelEditorIndex = null;
    modelEditorDraft = null;
  }

  function saveModelEditor(): void {
    if (!modelEditorDraft?.id.trim() || !providersStore.providerEdit) return;
    const draft = { ...modelEditorDraft, id: modelEditorDraft.id.trim() };
    if (modelEditorIndex === null) {
      const index = providersStore.providerEdit.models.length;
      addProviderModel(draft.id);
      updateProviderModel(index, draft);
    } else {
      const previousId = providersStore.providerEdit.models[modelEditorIndex]?.id;
      updateProviderModel(modelEditorIndex, draft);
      if (previousId && providersStore.providerEdit.defaultModel === previousId && previousId !== draft.id) {
        updateProviderEdit((provider) => ({ ...provider, defaultModel: draft.id }));
      }
    }
    closeModelEditor();
  }

  function toggleModelEditorTag(tag: DesktopProviderModel["tags"][number]): void {
    if (!modelEditorDraft) return;
    const tags = modelEditorDraft.tags.includes(tag)
      ? modelEditorDraft.tags.filter((item) => item !== tag)
      : [...modelEditorDraft.tags, tag];
    modelEditorDraft = { ...modelEditorDraft, tags: tags.length > 0 ? tags : ["text"] };
  }

  function toggleModelEditorRole(role: NonNullable<DesktopProviderModel["supportedRoles"]>[number]): void {
    if (!modelEditorDraft) return;
    const roles = modelEditorDraft.supportedRoles ?? [];
    modelEditorDraft = {
      ...modelEditorDraft,
      supportedRoles: roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role]
    };
  }

  async function openModelDiscovery(): Promise<void> {
    modelDiscoveryOpen = true;
    modelDiscoveryQuery = "";
    await discoverProviderModels();
  }

  let visibleModelsList = $derived.by(() => {
    if (!providersStore.providerEdit) return [];
    let list = providersStore.providerEdit.models.map((model, index) => ({ model, index }));

    const query = modelSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => item.model.id.toLowerCase().includes(query));
    }

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
              <div class="segmented" role="tablist" aria-label={session.text.providersMode}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={providersStore.globals.providerMode !== "custom"}
                  class="segmented-item"
                  class:active={providersStore.globals.providerMode !== "custom"}
                  onclick={() => {
                    providersStore.globals = { ...providersStore.globals, providerMode: "pi" };
                    providersStore.globalsDirty = true;
                  }}
                >{session.text.providersModePi}</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={providersStore.globals.providerMode === "custom"}
                  class="segmented-item"
                  class:active={providersStore.globals.providerMode === "custom"}
                  onclick={() => {
                    providersStore.globals = { ...providersStore.globals, providerMode: "custom" };
                    providersStore.globalsDirty = true;
                  }}
                >{session.text.providersModeCustom}</button>
              </div>
            </SettingRow>
            {#if providersStore.globals.providerMode !== "custom"}
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
            {:else}
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
            {/if}
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
                        label={providerEnabled(item) ? session.text.providerEnabled : session.text.providerDisabled}
                        state={providerEnabled(item) ? "ready" : "disconnected"}
                      />
                    </button>
                  {/each}
                </div>

                {#if selectedProvider?.kind === "builtin"}
                  {@const provider = selectedProvider.provider}
                  {@const savedProvider = providersStore.providers.customProviders.find((item) => item.id === provider.id)}
                  {@const inventory = providerInventory(selectedProvider)}
                  <section class="provider-browser-detail" aria-label={providerLabel(provider.name, provider.id)}>
                    <header class="provider-detail-head">
                      <div>
                        <h4>{providerLabel(provider.name, provider.id)}</h4>
                        <StatusBadge label={savedProvider?.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={savedProvider?.enabled ? "ready" : "disconnected"} />
                      </div>
                      <button class="secondary-button" type="button" disabled={providersStore.providerEdit !== null} onclick={() => beginBuiltinProviderEdit(provider)}>{session.text.providerEdit}</button>
                    </header>
                    <dl class="provider-summary">
                      <div><dt>{session.text.providerModels}</dt><dd>{provider.models.length}</dd></div>
                      <div><dt>{session.text.providerDefaultModel}</dt><dd>{provider.models[0] ? humanizeProviderName(provider.models[0].split("/").at(-1) ?? provider.models[0], provider.models[0]).label : "—"}</dd></div>
                      <div><dt>{session.text.providerApiKey}</dt><dd>{savedProvider?.hasApiKey ? session.text.providerApiKeyConfigured : session.text.providerApiKeyMissing}</dd></div>
                    </dl>
                    <section class="provider-model-inventory" aria-label={session.text.providerModelsSectionTitle}>
                      <header><div><strong>{session.text.providerModelsSectionTitle}</strong><small>{inventory.length} {session.text.providerModels}</small></div><button class="secondary-button" type="button" onclick={() => beginBuiltinProviderEdit(provider)}>{session.text.providerEdit}</button></header>
                      <div class="provider-model-inventory-list">
                        {#each inventory.slice(0, 8) as model, index (`${index}:${model.id}`)}
                          <button type="button" class="provider-model-inventory-row" onclick={() => openBrowserModelEditor(selectedProvider, index)}>
                            <span><strong>{model.id}</strong><small>{model.tags.join(" · ") || "text"}</small></span>
                            <StatusBadge label={model.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={model.enabled ? "ready" : "disconnected"} />
                            <i class="ph ph-caret-right" aria-hidden="true"></i>
                          </button>
                        {/each}
                      </div>
                    </section>
                    {#if selectedProviderAuth}
                      <div class="provider-auth-card">
                        <div class="provider-auth-card-copy">
                          <span>{session.text.providerAuthTitle}</span>
                          <strong>{selectedProviderAuthStatus}</strong>
                          <small>{selectedProviderAuth.effectiveAuth?.source ? session.text.providerAuthEffective.replace("{source}", selectedProviderAuth.effectiveAuth.source) : session.text.providerAuthHint}</small>
                        </div>
                        <StatusBadge label={selectedProviderAuthStatus} state={selectedProviderAuth.credential ? "ready" : "disconnected"} />
                        <div class="provider-auth-card-actions">
                          {#if selectedProviderAuth.credential}
                            <button class="secondary-button" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void logoutProviderAuth(provider.id)}>{session.text.providerAuthSignOut}</button>
                          {/if}
                          {#if selectedProviderAuth.credential}
                            <button class="secondary-button" type="button" disabled={Boolean(providerAuthStore.verifying)} onclick={() => void verifyProviderAuth(provider.id)}>{providerAuthStore.verifying === provider.id ? session.text.providerAuthVerifying : session.text.providerAuthVerify}</button>
                          {/if}
                          <button class="primary-button" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void beginProviderAuth(provider.id)}>{providerAuthStore.actionProviderId === provider.id ? session.text.loading : session.text.providerAuthSignIn}</button>
                        </div>
                        {#if selectedProviderVerification}
                          <p class="provider-auth-card-verdict" class:ok={selectedProviderVerification.ok}>
                            {#if selectedProviderVerification.ok}
                              <i class="ph ph-check-circle" aria-hidden="true"></i>{session.text.providerAuthVerifyOk.replace("{model}", selectedProviderVerification.modelId).replace("{ms}", String(selectedProviderVerification.elapsedMs))}
                            {:else}
                              <i class="ph ph-warning-circle" aria-hidden="true"></i>{session.text.providerAuthVerifyFailed.replace("{model}", selectedProviderVerification.modelId)}<span>{selectedProviderVerification.error}</span>
                            {/if}
                          </p>
                        {/if}
                        {#if selectedProviderAuth.apiKeyOverride}
                          <p class="provider-auth-card-warning">{session.text.providerAuthOverrideWarning}</p>
                        {/if}
                      </div>
                    {/if}
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
                  {@const inventory = providerInventory(selectedProvider)}
                  <section class="provider-browser-detail" aria-label={providerLabel(provider.name, provider.id)}>
                    <header class="provider-detail-head">
                      <div><h4>{providerLabel(provider.name, provider.id)}</h4><StatusBadge label={provider.isDefault ? session.text.providersDefault : provider.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={provider.enabled ? "ready" : "disconnected"} /></div>
                      <OverflowMenu label={session.text.more}><button role="menuitem" type="button" disabled={providersStore.providerEdit !== null} onclick={() => beginProviderEdit(provider.id)}><i class="ph ph-pencil-simple" aria-hidden="true"></i>{session.text.providerEdit}</button><button role="menuitem" type="button" disabled={provider.isDefault || providersStore.saving} onclick={() => void setProviderAsDefault(provider.id)}><i class="ph ph-star" aria-hidden="true"></i>{session.text.providersSetDefault}</button><button role="menuitem" type="button" disabled={providersStore.testingId !== null || !provider.hasApiKey} onclick={() => void verifyProvider(provider.id)}><i class="ph ph-plugs-connected" aria-hidden="true"></i>{providersStore.testingId === provider.id ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button><button role="menuitem" class="danger-action" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = provider.id)}><i class="ph ph-trash" aria-hidden="true"></i>{session.text.providerDelete}</button></OverflowMenu>
                    </header>
                    <dl class="provider-summary"><div><dt>{session.text.providerModels}</dt><dd>{provider.modelCount}</dd></div><div><dt>{session.text.providerDefaultModel}</dt><dd>{provider.defaultModel ? humanizeProviderName(provider.defaultModel.split("/").at(-1) ?? provider.defaultModel, provider.defaultModel).label : "—"}</dd></div><div><dt>{session.text.providerApiKey}</dt><dd>{provider.hasApiKey ? session.text.providerApiKeyConfigured : session.text.providerApiKeyMissing}</dd></div></dl>
                    <section class="provider-model-inventory" aria-label={session.text.providerModelsSectionTitle}>
                      <header><div><strong>{session.text.providerModelsSectionTitle}</strong><small>{inventory.length} {session.text.providerModels}</small></div><button class="secondary-button" type="button" onclick={() => beginProviderEdit(provider.id)}>{session.text.providerEdit}</button></header>
                      <div class="provider-model-inventory-list">
                        {#each inventory as model, index (`${index}:${model.id}`)}
                          <button type="button" class="provider-model-inventory-row" onclick={() => openBrowserModelEditor(selectedProvider, index)}>
                            <span><strong>{model.id}</strong><small>{model.tags.join(" · ") || "text"}</small></span>
                            <StatusBadge label={model.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={model.enabled ? "ready" : "disconnected"} />
                            <i class="ph ph-caret-right" aria-hidden="true"></i>
                          </button>
                        {/each}
                      </div>
                    </section>
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
            <Dialog open={Boolean(providersStore.providerEdit)} busy={providersStore.saving} contentClass="provider-modal-card" labelledBy="provider-edit-title" describedBy="provider-edit-hint" onOpenChange={(next) => { if (!next) closeProviderEdit(); }}>
            <form id="desktop-provider-edit-form" class="provider-modal-form" onsubmit={(event) => { event.preventDefault(); void saveProviderEdit(); }}>
              <header class="modal-head provider-modal-head">
                <div><strong id="provider-edit-title">{providersStore.providerEdit.isBuiltin ? session.text.providerBuiltinEditTitle : providersStore.providerEdit.isNew ? session.text.providerCreateTitle : session.text.providerEditTitle}</strong><p id="provider-edit-hint">{providersStore.providerEdit.isBuiltin ? session.text.providerBuiltinEditHint : session.text.providerSelfHostedHint}</p></div>
                <button class="modal-close" type="button" aria-label={session.text.cancel} disabled={providersStore.saving} onclick={closeProviderEdit}><i class="ph ph-x"></i></button>
              </header>
              <div class="modal-body provider-modal-body">
              {#if providersStore.providerEdit.isBuiltin}
                <div class="builtin-provider-editor">
                  <label class="settings-field settings-field-wide">
                    <span>{session.text.providerApiKey}</span>
                    <input type="password" bind:value={providersStore.editApiKey} placeholder={hasEditApiKey ? session.text.channelSecretConfigured : session.text.providerApiKeyMissing} autocomplete="new-password" />
                    {#if !providersStore.providerEdit.isNew}<label class="inline-check"><input type="checkbox" bind:checked={providersStore.editClearApiKey} /> {session.text.providerClearApiKey}</label>{/if}
                  </label>
                  <div class="builtin-provider-option-row">
                    <div><strong>{session.text.providerEnabledLabel}</strong><small>{providerLabel(providersStore.providerEdit.name, providersStore.providerEdit.id)}</small></div>
                    <IosSwitch checked={providersStore.providerEdit.enabled} ariaLabel={session.text.providerEnabledLabel} onCheckedChange={(checked) => updateProviderEdit((draft) => ({ ...draft, enabled: checked }))} />
                  </div>
                  <label class="settings-field settings-field-wide"><span>{session.text.providerDefaultModel}</span><select value={providersStore.providerEdit.defaultModel} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, defaultModel: (event.currentTarget as HTMLSelectElement).value }))}><option value="">—</option>{#each providersStore.providerEdit.models as model, i (`${i}:${model.id}`)}<option value={model.id}>{model.id || session.text.providerModelId}</option>{/each}</select></label>
                  <div class="builtin-provider-model-head">
                    <div><strong>{session.text.providerModels}</strong><p>{session.text.providerBuiltinModelsHint}</p></div>
                    <button class="secondary-button" type="button" onclick={openNewModelEditor}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.providerAddModel}</button>
                  </div>
                  <div class="builtin-provider-model-list">
                    {#each providersStore.providerEdit.models as model, index (`${index}:${model.id}`)}
                      <div class="builtin-provider-model-row">
                        <button type="button" class="builtin-provider-model-edit" onclick={() => openProviderEditModel(index)}><span>{model.id || session.text.providerModelId}</span><small>{model.tags.join(" · ") || "text"}</small></button>
                        <StatusBadge label={model.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={model.enabled ? "ready" : "disconnected"} />
                        <button class="row-icon-btn danger-action" type="button" title={session.text.providerModelRemove} aria-label={`${session.text.providerModelRemove}: ${model.id}`} onclick={() => removeProviderModel(index)}><i class="ph ph-trash" aria-hidden="true"></i></button>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
              <div class="settings-form provider-editor-grid">
                <label class="settings-field"><span>{session.text.providerId}</span><input value={providersStore.providerEdit.id} disabled={!providersStore.providerEdit.isNew} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.onboardingProviderName}</span><input value={providersStore.providerEdit.name} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.onboardingProviderProtocol}</span><select value={providersStore.providerEdit.protocol} onchange={(event) => updateProviderEdit((draft) => { const protocol = (event.currentTarget as HTMLSelectElement).value === "anthropic" ? "anthropic" : "openai-compatible"; const oldDefaultPath = defaultProviderPath(draft.protocol); return { ...draft, protocol, path: !draft.path.trim() || draft.path === oldDefaultPath ? defaultProviderPath(protocol) : draft.path }; })}><option value="openai-compatible">{session.text.protocolOpenaiCompatible}</option><option value="anthropic">{session.text.protocolAnthropic}</option></select></label>
                <label class="settings-field"><span>{session.text.onboardingProviderBaseUrl}</span><input value={providersStore.providerEdit.baseUrl} placeholder="https://…" oninput={(event) => updateProviderEdit((draft) => ({ ...draft, baseUrl: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{session.text.providerPath}</span><input value={providersStore.providerEdit.path} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, path: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{providersStore.providerEdit.isNew ? session.text.onboardingProviderApiKey : session.text.providerReplaceApiKey}</span><input type="password" bind:value={providersStore.editApiKey} autocomplete="new-password" />{#if providersStore.providerEdit.isNew}<small>{session.text.providerCreateKeyHint}</small>{/if}</label>
                <label class="settings-field settings-field-wide"><span>{session.text.providerDefaultModel}</span><select value={providersStore.providerEdit.defaultModel} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, defaultModel: (event.currentTarget as HTMLSelectElement).value }))}><option value="">—</option>{#each providersStore.providerEdit.models as model, i (`${i}:${model.id}`)}<option value={model.id}>{model.id || session.text.providerModelId}</option>{/each}</select></label>
              </div>

              <div class="provider-enable-row">
                <div><strong>{session.text.providerEnabledLabel}</strong><small>{providerLabel(providersStore.providerEdit.name, providersStore.providerEdit.id)}</small></div>
                <IosSwitch checked={providersStore.providerEdit.enabled} ariaLabel={session.text.providerEnabledLabel} onCheckedChange={(checked) => updateProviderEdit((draft) => ({ ...draft, enabled: checked }))} />
              </div>

              <section class="provider-models-section">
                <header class="provider-section-head">
                  <div><strong>{session.text.providerModelsSectionTitle}</strong><p>{session.text.providerCustomModelsHint}</p></div>
                  <div class="provider-section-actions"><button class="secondary-button" type="button" disabled={!canDiscoverModels} title={canDiscoverModels ? undefined : session.text.providerSaveBeforeRemote} onclick={() => void openModelDiscovery()}>{#if providersStore.discovering}<i class="ph ph-circle-notch spin" aria-hidden="true"></i>{session.text.loading}{:else}<i class="ph ph-download-simple" aria-hidden="true"></i>{session.text.providerPullModels}{/if}</button><button class="secondary-button" type="button" onclick={openNewModelEditor}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.providerAddModel}</button></div>
                </header>

                {#if providersStore.providerEdit.models.length > 1}
                  <div class="provider-model-controls">
                    <input type="text" class="row-input model-search-input" placeholder={session.text.modelSearchPlaceholder} bind:value={modelSearch} />
                    <button type="button" class="secondary-button sort-toggle-button" class:active={sortActiveFirst} aria-pressed={sortActiveFirst} onclick={() => (sortActiveFirst = !sortActiveFirst)}>
                      <i class="ph ph-sort-descending" aria-hidden="true"></i>{sortActiveFirst ? session.text.modelSortActive : session.text.modelSortDefault}
                    </button>
                  </div>
                {/if}

                {#if visibleModelsList.length === 0}
                  <EmptyState title={session.text.providersEmpty} icon="cube" />
                {:else}
                  <div class="provider-model-list">
                    {#each visibleModelsList as item (item.index)}
                      {@const model = item.model}
                      {@const index = item.index}
                      <div class="provider-model-card">
                        <button type="button" class="provider-model-card-main" onclick={() => openProviderEditModel(index)}><span><strong>{model.id || session.text.providerModelId}</strong><small>{model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : session.text.providerModelContext}</small></span><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                        <div class="provider-model-tags">
                          {#each model.tags as tag (tag)}
                            <span class="model-chip active">{tag}</span>
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
                        <div class="provider-model-actions"><StatusBadge label={model.enabled ? session.text.providerEnabled : session.text.providerDisabled} state={model.enabled ? "ready" : "disconnected"} /><button class="secondary-button" type="button" disabled={providersStore.providerEdit.isNew || !model.id.trim() || providersStore.testingId !== null} title={providersStore.providerEdit.isNew ? session.text.providerSaveBeforeRemote : undefined} onclick={() => void verifyProviderModel(index)}>{providersStore.testingId === `${providersStore.providerEdit.id}:${model.id}` ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button><button class="row-icon-btn danger-action" type="button" title={session.text.providerModelRemove} aria-label={`${session.text.providerModelRemove}: ${model.id}`} onclick={() => removeProviderModel(index)}><i class="ph ph-trash" aria-hidden="true"></i></button></div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </section>

              <details class="provider-advanced">
                <summary><i class="ph ph-caret-right provider-advanced-caret" aria-hidden="true"></i><i class="ph ph-sliders-horizontal" aria-hidden="true"></i><span>{session.text.providerAdvanced}</span></summary>
                <div class="provider-advanced-body">
                  <div class="settings-form provider-editor-grid">
                    <label class="settings-field"><span>{session.text.providerThinkingFormat}</span><select value={providersStore.providerEdit.thinkingFormat ?? ""} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, thinkingFormat: ((event.currentTarget as HTMLSelectElement).value || null) as DesktopProviderUpdateRequest["thinkingFormat"] }))}><option value="">{session.text.providerThinkingAuto}</option>{#each PROVIDER_THINKING_FORMATS as format (format)}<option value={format}>{format}</option>{/each}</select></label>
                  </div>
                  {#if !providersStore.providerEdit.isNew}
                    <label class="inline-check provider-advanced-check"><input type="checkbox" bind:checked={providersStore.editClearApiKey} /> {session.text.providerClearApiKey}</label>
                  {/if}
                </div>
              </details>
              {/if}
              {#if providersStore.actionMessage}<p class:run-history-failed={providersStore.actionFailed} class="settings-action-message provider-modal-message">{providersStore.actionMessage}</p>{/if}
              </div>
              <footer class="provider-modal-foot">
                <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={closeProviderEdit}>{session.text.cancel}</button>
                <button class="primary-button" type="submit" disabled={providersStore.saving || !providersStore.providerEdit.id.trim() || !providersStore.providerEdit.name.trim() || (!providersStore.providerEdit.isBuiltin && (!providersStore.providerEdit.baseUrl.trim() || (providersStore.providerEdit.isNew && !providersStore.editApiKey.trim())))}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
              </footer>
            </form>
            </Dialog>
            {#if modelEditorDraft}
              <Dialog open={true} contentClass="provider-model-edit-dialog" labelledBy="provider-model-edit-title" describedBy="provider-model-edit-description" onOpenChange={(next) => { if (!next) closeModelEditor(); }}>
                <form class="provider-model-edit-form" onsubmit={(event) => { event.preventDefault(); saveModelEditor(); }}>
                  <header class="modal-head"><div><strong id="provider-model-edit-title">{modelEditorIndex === null ? session.text.providerAddModel : session.text.providerModelEditTitle}</strong><p id="provider-model-edit-description">{session.text.providerModelEditHint}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={closeModelEditor}><i class="ph ph-x"></i></button></header>
                  <div class="modal-body provider-model-edit-body">
                    <label class="settings-field settings-field-wide"><span>{session.text.providerModelId}</span><input value={modelEditorDraft.id} placeholder="gpt-5" oninput={(event) => (modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, id: (event.currentTarget as HTMLInputElement).value } : null)} /></label>
                    <label class="settings-field settings-field-wide"><span>{session.text.providerModelContext}</span><input type="number" min="1" value={modelEditorDraft.contextWindow ?? ""} placeholder="200000" oninput={(event) => { const value = Number((event.currentTarget as HTMLInputElement).value); modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, contextWindow: Number.isFinite(value) && value > 0 ? value : undefined } : null; }} /></label>
                    <div class="provider-model-edit-switch"><div><strong>{session.text.providerModelEnabled}</strong><small>{modelEditorDraft.id || session.text.providerModelId}</small></div><IosSwitch checked={modelEditorDraft.enabled} ariaLabel={session.text.providerModelEnabled} onCheckedChange={(enabled) => (modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, enabled } : null)} /></div>
                    <fieldset class="provider-model-edit-options"><legend>{session.text.providerModelTags}</legend><div>{#each PROVIDER_MODEL_TAGS as tag (tag)}<button type="button" class:active={modelEditorDraft.tags.includes(tag)} class="model-chip" onclick={() => toggleModelEditorTag(tag)}>{tag}</button>{/each}</div></fieldset>
                    <fieldset class="provider-model-edit-options"><legend>{session.text.providerModelRoles}</legend><div>{#each PROVIDER_MODEL_ROLES as role (role)}<button type="button" class:active={(modelEditorDraft.supportedRoles ?? []).includes(role)} class="model-chip" onclick={() => toggleModelEditorRole(role)}>{role}</button>{/each}</div></fieldset>
                  </div>
                  <footer class="provider-modal-foot"><button class="secondary-button" type="button" onclick={closeModelEditor}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={!modelEditorDraft.id.trim()}>{session.text.save}</button></footer>
                </form>
              </Dialog>
            {/if}
            {#if modelDiscoveryOpen}
              <Dialog open={true} contentClass="provider-model-discovery-dialog" labelledBy="provider-model-discovery-title" describedBy="provider-model-discovery-description" onOpenChange={(next) => { if (!next) modelDiscoveryOpen = false; }}>
                <header class="modal-head"><div><strong id="provider-model-discovery-title">{session.text.providerModelsAvailableTitle}</strong><p id="provider-model-discovery-description">{session.text.providerModelsAvailableHint.replace("{count}", String(providersStore.discoveredModels.length))}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (modelDiscoveryOpen = false)}><i class="ph ph-x"></i></button></header>
                <div class="modal-body provider-model-discovery-body">
                  <SearchField value={modelDiscoveryQuery} label={session.text.modelSearchPlaceholder} placeholder={session.text.modelSearchPlaceholder} onInput={(value) => (modelDiscoveryQuery = value)} />
                  {#if providersStore.discovering}<SkeletonRows count={5} />{:else if visibleDiscoveredModels.length === 0}<EmptyState title={providersStore.discoveredModels.length === 0 ? session.text.providerModelPickEmpty : session.text.providerModelPickNoMatch} icon="magnifying-glass" />{:else}<div class="provider-model-discovery-list" role="list">{#each visibleDiscoveredModels as id (id)}<div class="provider-model-discovery-row" role="listitem"><span>{id}</span><button class="secondary-button" type="button" disabled={editModelIds.has(id)} onclick={() => addDiscoveredModel(id)}>{editModelIds.has(id) ? session.text.providerModelAdded : session.text.providerAddModel}</button></div>{/each}</div>{/if}
                </div>
                <footer class="provider-modal-foot"><button class="primary-button" type="button" onclick={() => (modelDiscoveryOpen = false)}>{session.text.save}</button></footer>
              </Dialog>
            {/if}
          {/if}
          {#if providersStore.actionMessage && !providersStore.providerEdit}
            <p class:run-history-failed={providersStore.actionFailed} class="settings-action-message">{providersStore.actionMessage}</p>
          {/if}
        {/if}

{#if pendingDeleteProviderId}
  <AlertDialog open={Boolean(pendingDeleteProviderId)} busy={providersStore.saving} contentClass="confirm-dialog" labelledBy="provider-delete-title" describedBy="provider-delete-description" onOpenChange={(next) => { if (!next) pendingDeleteProviderId = ""; }}>
    <h3 id="provider-delete-title">{session.text.providerDelete}</h3>
    <p id="provider-delete-description">{session.text.providerDeleteConfirm}</p>
    <div class="confirm-dialog-actions">
      <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = "")}>{session.text.cancel}</button>
      <button class="primary-button danger-button" type="button" disabled={providersStore.saving} onclick={async () => { const providerId = pendingDeleteProviderId; await removeProvider(providerId); pendingDeleteProviderId = ""; }}>{session.text.providerDelete}</button>
    </div>
  </AlertDialog>
{/if}

{#if providerAuthStore.active}
  {@const authSession = providerAuthStore.active}
  <Dialog open={true} contentClass="provider-auth-dialog" labelledBy="provider-auth-title" describedBy="provider-auth-description" onOpenChange={(next) => { if (!next) void closeProviderAuth(); }}>
    <header class="modal-head provider-auth-dialog-head">
      <div>
        <strong id="provider-auth-title">{providerAuthStore.providers.find((provider) => provider.id === authSession.providerId)?.loginLabel ?? session.text.providerAuthTitle}</strong>
        <p id="provider-auth-description">{session.text.providerAuthDialogHint}</p>
      </div>
      <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => void closeProviderAuth()}><i class="ph ph-x"></i></button>
    </header>
    <div class="modal-body provider-auth-dialog-body">
      {#if authSession.state === "done"}
        <div class="provider-auth-terminal success"><i class="ph ph-check-circle" aria-hidden="true"></i><strong>{session.text.providerAuthDone}</strong></div>
      {:else if authSession.state === "failed"}
        <div class="provider-auth-terminal danger"><i class="ph ph-warning-circle" aria-hidden="true"></i><strong>{session.text.providerAuthFailed}</strong><span>{authSession.error ?? providerAuthStore.error}</span></div>
      {:else if authSession.state === "cancelled"}
        <div class="provider-auth-terminal"><i class="ph ph-x-circle" aria-hidden="true"></i><strong>{session.text.providerAuthCancelled}</strong></div>
      {:else if authSession.state === "expired"}
        <div class="provider-auth-terminal danger"><i class="ph ph-clock-countdown" aria-hidden="true"></i><strong>{session.text.providerAuthExpired}</strong></div>
      {:else}
        <div class="provider-auth-progress-head"><span class="provider-auth-pulse" aria-hidden="true"></span><strong>{session.text.providerAuthWaiting}</strong></div>

        {#if authSession.authUrl}
          <section class="provider-auth-step">
            <div><i class="ph ph-browser" aria-hidden="true"></i><span>{authSession.authUrl.instructions ?? session.text.providerAuthOpenBrowser}</span></div>
            <button class="primary-button" type="button" onclick={() => void openProviderAuthUrl(authSession.authUrl!.url)}>{session.text.providerAuthOpenBrowser}<i class="ph ph-arrow-square-out" aria-hidden="true"></i></button>
          </section>
        {/if}

        {#if authSession.deviceCode}
          <section class="provider-auth-device">
            <span>{session.text.providerAuthDeviceCode}</span>
            <code>{authSession.deviceCode.userCode}</code>
            <div>
              <button class="secondary-button" type="button" onclick={() => void copyProviderAuthCode(authSession.deviceCode!.userCode)}>{authCopiedCode === authSession.deviceCode.userCode ? session.text.providerAuthCodeCopied : session.text.providerAuthCopyCode}</button>
              <button class="primary-button" type="button" onclick={() => void openProviderAuthUrl(authSession.deviceCode!.verificationUri)}>{session.text.providerAuthOpenBrowser}<i class="ph ph-arrow-square-out" aria-hidden="true"></i></button>
            </div>
          </section>
        {/if}

        {#if authSession.prompt}
          <section class="provider-auth-prompt">
            <strong>{authSession.prompt.message}</strong>
            {#if authSession.prompt.type === "select"}
              <div class="provider-auth-options">
                {#each authSession.prompt.options ?? [] as option (option.id)}
                  <button class="provider-auth-option" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void submitProviderAuthAnswer(option.id)}><span>{option.label}</span>{#if option.description}<small>{option.description}</small>{/if}<i class="ph ph-caret-right" aria-hidden="true"></i></button>
                {/each}
              </div>
            {:else}
              <form class="provider-auth-answer" onsubmit={(event) => { event.preventDefault(); void submitProviderAuthAnswer(); }}>
                <input type={authSession.prompt.type === "secret" ? "password" : "text"} bind:value={providerAuthStore.answer} placeholder={authSession.prompt.placeholder ?? session.text.providerAuthAnswerPlaceholder} autocomplete="off" />
                <button class="primary-button" type="submit" disabled={Boolean(providerAuthStore.actionProviderId) || (authSession.prompt.type !== "text" && !providerAuthStore.answer.trim())}>{session.text.providerAuthContinue}</button>
              </form>
            {/if}
          </section>
        {/if}

        {#if authSession.messages.length > 0}
          <div class="provider-auth-messages">
            {#each authSession.messages.slice(-4) as message (message.id)}
              <p>{message.message}</p>
            {/each}
          </div>
        {/if}
      {/if}
      {#if providerAuthStore.error}<p class="settings-action-message run-history-failed">{providerAuthStore.error}</p>{/if}
    </div>
    <footer class="provider-auth-dialog-foot">
      <button class="secondary-button" type="button" onclick={() => void closeProviderAuth()}>{providerAuthIsTerminal(authSession.state) ? session.text.providerAuthClose : session.text.cancel}</button>
    </footer>
  </Dialog>
{/if}

{#if providersStore.globalsDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={providersStore.saving} onclick={() => void saveProviderGlobals()}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.providerSaveGlobal}</button>
    </div>
  </footer>
{/if}

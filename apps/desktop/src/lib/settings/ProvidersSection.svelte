<script lang="ts">
  import type { DesktopProviderUpdateRequest } from "@molibot/desktop-contract";
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
</script>

        <p class="settings-section-hint">{session.text.providersHint}</p>
        {#if !session.serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{session.text.providersUnavailable}</p></div></div>
        {:else if providersStore.loading || !providersStore.providers}
          <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row">
              <div><strong>{session.text.providersMode}</strong></div>
              <select value={providersStore.globals.providerMode} onchange={(event) => { providersStore.globals = { ...providersStore.globals, providerMode: (event.currentTarget as HTMLSelectElement).value === "custom" ? "custom" : "pi" }; providersStore.globalsDirty = true; }}>
                <option value="pi">{session.text.providersModePi}</option>
                <option value="custom">{session.text.providersModeCustom}</option>
              </select>
            </div>
          </div>
          <p class="settings-group-title">{session.text.providerBuiltinTitle}</p>
          <div class="settings-card">
            <label class="settings-row"><strong>{session.text.providersPiProvider}</strong><select value={providersStore.globals.piProvider} onchange={(event) => { const piProvider = (event.currentTarget as HTMLSelectElement).value; const piModel = providersStore.providers?.builtinProviders.find((provider) => provider.id === piProvider)?.models[0] ?? ""; providersStore.globals = { ...providersStore.globals, piProvider, piModel }; providersStore.globalsDirty = true; }}><option value="">—</option>{#each providersStore.providers.builtinProviders as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select></label>
            <label class="settings-row"><strong>{session.text.providersPiModel}</strong><select value={providersStore.globals.piModel} onchange={(event) => { providersStore.globals = { ...providersStore.globals, piModel: (event.currentTarget as HTMLSelectElement).value }; providersStore.globalsDirty = true; }}><option value="">—</option>{#each providersStore.providers.builtinProviders.find((provider) => provider.id === providersStore.globals.piProvider)?.models ?? [] as model (model)}<option value={model}>{model}</option>{/each}</select></label>
          </div>
          <div class="channel-section-head provider-section-head">
            <div><p class="settings-group-title">{session.text.providerSelfHostedTitle}</p><p class="settings-section-hint">{session.text.providerSelfHostedHint}</p></div>
            <button class="secondary-button" type="button" disabled={providersStore.providerEdit !== null} onclick={beginNewProvider}>{session.text.providerAdd}</button>
          </div>
          <div class="settings-card">
            <label class="settings-row">
              <strong>{session.text.providerSetDefault}</strong>
              <select value={providersStore.globals.defaultCustomProviderId} onchange={(event) => { providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: (event.currentTarget as HTMLSelectElement).value }; providersStore.globalsDirty = true; }}>
                <option value="">—</option>
                {#each providersStore.providers.customProviders.filter((provider) => provider.enabled) as provider (provider.id)}
                  <option value={provider.id}>{provider.name}</option>
                {/each}
              </select>
            </label>
          </div>
          {#if providersStore.providers.customProviders.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{session.text.providersEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each providersStore.providers.customProviders as provider (provider.id)}
                <div class="settings-row">
                  <div class="profile-info">
                    <strong>{provider.name}{provider.isDefault ? ` · ${session.text.providersDefault}` : ""}</strong>
                    <p>{session.text.providerProtocol}: {provider.protocol} · {provider.baseUrl}</p>
                    <p>{session.text.providerModels}: {provider.modelCount}{provider.defaultModel ? ` · ${session.text.providerDefaultModel}: ${provider.defaultModel}` : ""}</p>
                    <p>{session.text.providerApiKey}: {provider.hasApiKey ? session.text.providerApiKeyConfigured : session.text.providerApiKeyMissing}</p>
                  </div>
                  <div class="settings-row-actions">
                    <span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
                    <button class="secondary-button" type="button" onclick={() => beginProviderEdit(provider.id)}>{session.text.providerEdit}</button>
                    <button class="secondary-button" type="button" disabled={provider.isDefault || providersStore.saving} onclick={() => void setProviderAsDefault(provider.id)}>{session.text.providersSetDefault}</button>
                    <button class="secondary-button" type="button" disabled={providersStore.testingId !== null || !provider.hasApiKey} onclick={() => void verifyProvider(provider.id)}>
                      {providersStore.testingId === provider.id ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}
                    </button>
                    <button class="secondary-button danger-action" type="button" disabled={providersStore.saving} onclick={() => void removeProvider(provider.id)}>{session.text.providerDelete}</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
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
                  <button class="secondary-button" type="button" disabled={providersStore.providerEdit.isNew || providersStore.discovering || !providersStore.providers.customProviders.find((item) => item.id === providersStore.providerEdit?.id)?.hasApiKey} title={providersStore.providerEdit.isNew ? session.text.providerSaveBeforeRemote : undefined} onclick={() => void discoverProviderModels()}>{providersStore.discovering ? session.text.loading : session.text.providerPullModels}</button>
                </div>
              </div>
              {#if providersStore.discoveredModels.length > 0}
                <div class="provider-discovered-models">
                  {#each providersStore.discoveredModels as modelId (modelId)}
                    <button type="button" class="model-chip" disabled={providersStore.providerEdit.models.some((model) => model.id === modelId)} onclick={() => addProviderModel(modelId)}>+ {modelId}</button>
                  {/each}
                </div>
              {/if}
              <div class="provider-model-list">
                {#each providersStore.providerEdit.models as model, index (`${index}:${model.id}`)}
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

{#if providersStore.globalsDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={providersStore.saving} onclick={() => void saveProviderGlobals()}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.providerSaveGlobal}</button>
    </div>
  </footer>
{/if}

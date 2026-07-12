<script lang="ts">
  import { session } from "../stores/session.svelte";
  import {
    pluginsStore,
    discardPlugins,
    loadPlugins,
    savePluginsEditor,
    togglePluginSecretClear,
    updatePluginSecret,
    updatePluginValue
  } from "../stores/plugins.svelte";
  import { startDailyMaterialsBackfill, loadDailyMaterialsBackfillStatus } from "../api";
  import type { DailyMaterialsBackfillStatus } from "@molibot/desktop-contract";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== pluginsStore.endpoint) {
      void loadPlugins(session.endpoint);
    }
  });

  const pluginsDirty = $derived(pluginsStore.pluginsEdit !== null && JSON.stringify(pluginsStore.pluginsEdit) !== pluginsStore.pristine);

  // The backfill runs against the SAVED daily-materials config, so it is only
  // offered once the feature is enabled and a project is selected server-side.
  const dailyMaterialsSaved = $derived(pluginsStore.plugins?.memory.dailyMaterials);
  const backfillAvailable = $derived(Boolean(dailyMaterialsSaved?.enabled && dailyMaterialsSaved?.projectId));

  let backfillStatus = $state<DailyMaterialsBackfillStatus | null>(null);
  let backfillPolling = $state(false);
  const backfillRunning = $derived(backfillStatus?.status === "running" || backfillPolling);

  const backfillMessage = $derived.by(() => {
    const status = backfillStatus;
    if (!status || status.status === "idle") return "";
    if (status.status === "running") {
      return `${session.text.memoryDailyMaterialsBackfillProgress} ${status.processed}/${status.total || "…"} · ${session.text.memoryDailyMaterialsBackfillDays} ${status.daysWithData}`;
    }
    if (status.status === "done") {
      const range = status.from && status.to ? `（${status.from} ~ ${status.to}）` : "";
      return `${session.text.memoryDailyMaterialsBackfillDone} ${status.daysWithData}${range}`;
    }
    return `${session.text.memoryDailyMaterialsBackfillError}${status.error ? `：${status.error}` : ""}`;
  });

  async function pollBackfill(): Promise<void> {
    if (!session.endpoint) return;
    backfillPolling = true;
    try {
      while (session.endpoint) {
        const status = await loadDailyMaterialsBackfillStatus(session.endpoint);
        backfillStatus = status;
        if (status.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (cause) {
      backfillStatus = { status: "error", total: 0, processed: 0, daysWithData: 0, createdFiles: 0, scannedMessages: 0, error: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      backfillPolling = false;
    }
  }

  async function startBackfill(): Promise<void> {
    if (!session.endpoint || backfillRunning) return;
    try {
      backfillStatus = await startDailyMaterialsBackfill(session.endpoint);
      void pollBackfill();
    } catch (cause) {
      backfillStatus = { status: "error", total: 0, processed: 0, daysWithData: 0, createdFiles: 0, scannedMessages: 0, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
</script>

<p class="settings-section-hint">{session.text.pluginsHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.pluginsUnavailable}</p></div></div>
{:else if pluginsStore.loading || !pluginsStore.plugins}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.pluginsTotal}</strong><span class="diag-value">{pluginsStore.plugins.counts.total} · {session.text.pluginsActive}: {pluginsStore.plugins.counts.active} · {session.text.pluginsExternal}: {pluginsStore.plugins.counts.external}</span></div>
  </div>
  {#if pluginsStore.pluginsEdit}
    <form id="desktop-plugins-form" class="settings-card provider-editor" onsubmit={(event) => { event.preventDefault(); void savePluginsEditor(); }}>
      <div class="provider-editor-toolbar"><strong>{session.text.pluginsMemorySettings}</strong></div>
      <div class="settings-row"><strong>{session.text.pluginsMemoryEnabled}</strong><button class:active={pluginsStore.pluginsEdit.memoryEnabled} class="switch" type="button" role="switch" aria-label={session.text.pluginsMemoryEnabled} aria-checked={pluginsStore.pluginsEdit.memoryEnabled} onclick={() => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryEnabled: !pluginsStore.pluginsEdit.memoryEnabled }; }}><span></span></button></div>
      <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryBackend}</span><select value={pluginsStore.pluginsEdit.memoryBackend} onchange={(event) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryBackend: event.currentTarget.value }; }}>{#each pluginsStore.plugins.memory.backends as backend (backend.value)}<option value={backend.value}>{backend.label}</option>{/each}</select></label></div>
      <div class="settings-form"><label class="settings-field"><span>{session.text.memoryEmbeddingProvider}</span><select value={pluginsStore.pluginsEdit.memoryEmbeddingProviderId} onchange={(event) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryEmbeddingProviderId: event.currentTarget.value }; }}><option value="">{session.text.unavailable}</option>{#each pluginsStore.plugins.memory.embeddingProviders as provider (provider.value)}<option value={provider.value}>{provider.label}</option>{/each}</select></label><label class="settings-field"><span>{session.text.memoryEmbeddingModel}</span><input bind:value={pluginsStore.pluginsEdit.memoryEmbeddingModel} placeholder="text-embedding-3-small" /></label></div>
      <div class="settings-form"><label class="settings-field"><span>{session.text.memoryReflectionTime}</span><input type="time" bind:value={pluginsStore.pluginsEdit.memoryReflectionTime} /></label><div class="settings-row settings-field"><div><strong>{session.text.memoryReflectionNotifications}</strong><p>{session.text.memoryReflectionNotificationsHint}</p></div><button class:active={pluginsStore.pluginsEdit.memoryReflectionNotifications} class="switch" type="button" role="switch" aria-label={session.text.memoryReflectionNotifications} aria-checked={pluginsStore.pluginsEdit.memoryReflectionNotifications} onclick={() => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryReflectionNotifications: !pluginsStore.pluginsEdit.memoryReflectionNotifications }; }}><span></span></button></div></div>
      <div class="provider-editor-toolbar"><div><strong>{session.text.memoryDailyMaterials}</strong><p>{session.text.memoryDailyMaterialsHint}</p></div></div>
      <div class="settings-row"><strong>{session.text.memoryDailyMaterialsEnabled}</strong><button class:active={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled} class="switch" type="button" role="switch" aria-label={session.text.memoryDailyMaterialsEnabled} aria-checked={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled} onclick={() => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryDailyMaterials: { ...pluginsStore.pluginsEdit.memoryDailyMaterials, enabled: !pluginsStore.pluginsEdit.memoryDailyMaterials.enabled } }; }}><span></span></button></div>
      <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsTime}</span><input type="time" bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.time} /></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsProject}</span><select bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.projectId}><option value="">{session.text.memoryDailyMaterialsProjectEmpty}</option>{#each pluginsStore.plugins.memory.projects as project (project.value)}<option value={project.value}>{project.label}</option>{/each}</select></label></div>
      <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsDir}</span><input bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.dir} /></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsPrompt}</span><input bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.promptPath} /></label></div>
      <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsBudget}</span><input type="number" min="8000" max="900000" step="1000" bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.scanTokenBudget} /><small class="settings-field-hint">{session.text.memoryDailyMaterialsBudgetHint}</small></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsModel}</span><select bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.scanModelKey}><option value="">{session.text.memoryDailyMaterialsModelDefault}</option>{#each pluginsStore.plugins.memory.scanModels as model (model.value)}<option value={model.value}>{model.label}</option>{/each}</select><small class="settings-field-hint">{session.text.memoryDailyMaterialsModelHint}</small></label></div>
      <div class="settings-row"><div><strong>{session.text.memoryDailyMaterialsNotifications}</strong><p>{session.text.memoryDailyMaterialsNotificationsHint}</p></div><button class:active={pluginsStore.pluginsEdit.memoryDailyMaterials.notifications} class="switch" type="button" role="switch" aria-label={session.text.memoryDailyMaterialsNotifications} aria-checked={pluginsStore.pluginsEdit.memoryDailyMaterials.notifications} onclick={() => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryDailyMaterials: { ...pluginsStore.pluginsEdit.memoryDailyMaterials, notifications: !pluginsStore.pluginsEdit.memoryDailyMaterials.notifications } }; }}><span></span></button></div>
      {#if backfillAvailable}
        <div class="settings-row daily-backfill-row">
          <div>
            <strong>{session.text.memoryDailyMaterialsBackfill}</strong>
            <p>{session.text.memoryDailyMaterialsBackfillHint}</p>
            {#if backfillMessage}<p class="daily-backfill-status" class:is-error={backfillStatus?.status === "error"}>{backfillMessage}</p>{/if}
            {#if pluginsDirty}<p class="daily-backfill-status">{session.text.memoryDailyMaterialsBackfillDirty}</p>{/if}
          </div>
          <button class="secondary-button" type="button" disabled={backfillRunning} onclick={() => void startBackfill()}>{backfillRunning ? session.text.memoryDailyMaterialsBackfillRunning : session.text.memoryDailyMaterialsBackfillStart}</button>
        </div>
      {/if}
      {#each pluginsStore.plugins.featureSettings as plugin (plugin.pluginKey)}
        <div class="provider-editor-toolbar"><div><strong>{plugin.name}</strong>{#if plugin.description}<p class="settings-section-hint">{plugin.description}</p>{/if}</div></div>
        <div class="settings-form">
          {#each plugin.fields as field (`${plugin.pluginKey}:${field.key}`)}
            {#if field.type === "boolean"}
              <div class="settings-row settings-field-wide"><div><strong>{field.label}</strong>{#if field.description}<p>{field.description}</p>{/if}</div><button class:active={Boolean(pluginsStore.pluginsEdit.values[plugin.pluginKey]?.[field.key])} class="switch" type="button" role="switch" aria-label={field.label} aria-checked={Boolean(pluginsStore.pluginsEdit.values[plugin.pluginKey]?.[field.key])} onclick={() => updatePluginValue(plugin.pluginKey, field.key, !Boolean(pluginsStore.pluginsEdit?.values[plugin.pluginKey]?.[field.key]))}><span></span></button></div>
            {:else if field.type === "select"}
              <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><select value={String(pluginsStore.pluginsEdit.values[plugin.pluginKey]?.[field.key] ?? field.value)} onchange={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)}>{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select>{#if field.description}<small>{field.description}</small>{/if}</label>
            {:else if field.type === "password"}
              <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input type="password" value={pluginsStore.pluginsEdit.secretValues[plugin.pluginKey]?.[field.key] ?? ""} placeholder={field.configured ? session.text.channelSecretConfigured : field.placeholder} autocomplete="new-password" oninput={(event) => updatePluginSecret(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.configured}<label class="inline-check"><input type="checkbox" checked={pluginsStore.pluginsEdit.clearSecrets[plugin.pluginKey]?.includes(field.key)} onchange={() => togglePluginSecretClear(plugin.pluginKey, field.key)} /> {session.text.channelClearSecret}</label>{/if}{#if field.description}<small>{field.description}</small>{/if}</label>
            {:else}
              <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input value={String(pluginsStore.pluginsEdit.values[plugin.pluginKey]?.[field.key] ?? field.value)} placeholder={field.placeholder} oninput={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.description}<small>{field.description}</small>{/if}</label>
            {/if}
          {/each}
        </div>
      {/each}
    </form>
  {/if}
  {#if pluginsStore.plugins.items.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.pluginsEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each pluginsStore.plugins.items as item (`${item.kind}:${item.key}`)}
        <div class="settings-row">
          <div class="profile-info"><strong>{item.name}{item.version ? ` · ${item.version}` : ""}</strong><p>{item.kind === "channel" ? session.text.pluginKindChannel : item.kind === "provider" ? session.text.pluginKindProvider : item.kind === "memory-backend" ? session.text.pluginKindMemoryBackend : session.text.pluginKindFeature} · {item.source === "external" ? session.text.pluginsExternal : session.text.pluginsBuiltIn}{item.description ? ` · ${item.description}` : ""}{item.error ? ` · ${item.error}` : ""}</p></div>
          <span class="status-badge" data-state={item.status === "active" ? "ready" : item.status === "error" ? "error" : "disconnected"}>{item.status === "active" ? session.text.pluginStatusActive : item.status === "error" ? session.text.pluginStatusError : session.text.pluginStatusDiscovered}</span>
        </div>
      {/each}
    </div>
  {/if}
  {#if pluginsStore.actionMessage}<p class="settings-action-message">{pluginsStore.actionMessage}</p>{/if}
{/if}

{#if pluginsDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={pluginsStore.saving} onclick={discardPlugins}>{session.text.discardChanges}</button>
      <button class="primary-button" type="submit" form="desktop-plugins-form" disabled={pluginsStore.saving}>{pluginsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}

<style>
  .daily-backfill-status {
    margin-top: 6px;
    color: var(--label-secondary);
    font-size: 12px;
    line-height: 1.4;
  }
  .daily-backfill-status.is-error {
    color: var(--danger);
  }
  .settings-field-hint {
    margin-top: 4px;
    color: var(--label-secondary);
    font-size: 12px;
    line-height: 1.4;
  }
</style>

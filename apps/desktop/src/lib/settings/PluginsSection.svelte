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

  const dailyMaterialsSaved = $derived(pluginsStore.plugins?.memory.dailyMaterials);
  const backfillAvailable = $derived(Boolean(dailyMaterialsSaved?.enabled && dailyMaterialsSaved?.projectId));

  let backfillStatus = $state<DailyMaterialsBackfillStatus | null>(null);
  let backfillPolling = $state(false);
  const backfillRunning = $derived(backfillStatus?.status === "running" || backfillPolling);

  // Accordion state: only one plugin card expanded at a time. Null = all collapsed.
  let expandedPlugin = $state<string | null>(null);

  function togglePluginExpanded(key: string): void {
    expandedPlugin = expandedPlugin === key ? null : key;
  }

  function setMemoryEnabled(value: boolean): void {
    if (!pluginsStore.pluginsEdit) return;
    pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryEnabled: value };
  }

  function setDailyMaterialsEnabled(value: boolean): void {
    if (!pluginsStore.pluginsEdit) return;
    pluginsStore.pluginsEdit = {
      ...pluginsStore.pluginsEdit,
      memoryDailyMaterials: { ...pluginsStore.pluginsEdit.memoryDailyMaterials, enabled: value }
    };
  }

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

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.pluginsUnavailable}</p></div></div>
{:else if pluginsStore.loading || !pluginsStore.plugins}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if pluginsStore.pluginsEdit}
  <form id="desktop-plugins-form" class="settings-card plugin-collapsible-list" onsubmit={(event) => { event.preventDefault(); void savePluginsEditor(); }}>
    <!-- Memory backend settings -->
    <section class="plugin-collapsible" class:is-open={expandedPlugin === "memory"}>
      <div class="settings-row plugin-collapsible-head">
        <div class="profile-info">
          <strong>{session.text.pluginsMemorySettings}</strong>
          <p>{session.text.pluginsMemorySettingsHint}</p>
        </div>
        <div class="settings-row-actions">
          <span class="status-badge" data-state={pluginsStore.pluginsEdit.memoryEnabled ? "ready" : "disconnected"}>{pluginsStore.pluginsEdit.memoryEnabled ? session.text.pluginEnabled : session.text.pluginDisabled}</span>
          <button class:active={pluginsStore.pluginsEdit.memoryEnabled} class="switch" type="button" role="switch" aria-label={session.text.pluginsMemoryEnabled} aria-checked={pluginsStore.pluginsEdit.memoryEnabled} onclick={() => setMemoryEnabled(!pluginsStore.pluginsEdit!.memoryEnabled)}><span></span></button>
          <button class="secondary-button plugin-collapsible-toggle" type="button" aria-expanded={expandedPlugin === "memory"} onclick={() => togglePluginExpanded("memory")}>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
            <span>{expandedPlugin === "memory" ? session.text.pluginCollapse : session.text.pluginEdit}</span>
          </button>
        </div>
      </div>
      {#if expandedPlugin === "memory"}
        <div class="plugin-collapsible-body">
          <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryBackend}</span><select value={pluginsStore.pluginsEdit.memoryBackend} onchange={(event) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryBackend: event.currentTarget.value }; }}>{#each pluginsStore.plugins.memory.backends as backend (backend.value)}<option value={backend.value}>{backend.label}</option>{/each}</select></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryEmbeddingProvider}</span><select value={pluginsStore.pluginsEdit.memoryEmbeddingProviderId} onchange={(event) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryEmbeddingProviderId: event.currentTarget.value }; }}><option value="">{session.text.unavailable}</option>{#each pluginsStore.plugins.memory.embeddingProviders as provider (provider.value)}<option value={provider.value}>{provider.label}</option>{/each}</select></label><label class="settings-field"><span>{session.text.memoryEmbeddingModel}</span><input bind:value={pluginsStore.pluginsEdit.memoryEmbeddingModel} placeholder="text-embedding-3-small" /></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryReflectionTime}</span><input type="time" bind:value={pluginsStore.pluginsEdit.memoryReflectionTime} /></label><div class="settings-row settings-field"><div><strong>{session.text.memoryReflectionNotifications}</strong><p>{session.text.memoryReflectionNotificationsHint}</p></div><button class:active={pluginsStore.pluginsEdit.memoryReflectionNotifications} class="switch" type="button" role="switch" aria-label={session.text.memoryReflectionNotifications} aria-checked={pluginsStore.pluginsEdit.memoryReflectionNotifications} onclick={() => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryReflectionNotifications: !pluginsStore.pluginsEdit.memoryReflectionNotifications }; }}><span></span></button></div></div>
          <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryReflectionNotificationTarget}</span><select bind:value={pluginsStore.pluginsEdit.memoryReflectionNotificationTarget} disabled={!pluginsStore.pluginsEdit.memoryReflectionNotifications}><option value="">{session.text.memoryReflectionNotificationTargetEmpty}</option>{#each pluginsStore.plugins.memory.reflectionNotificationTargets as target (target.value)}<option value={target.value}>{target.label}</option>{/each}</select><small class="settings-field-hint">{session.text.memoryReflectionNotificationTargetHint}</small></label></div>
        </div>
      {/if}
    </section>

    <!-- Daily materials -->
    <section class="plugin-collapsible" class:is-open={expandedPlugin === "dailyMaterials"}>
      <div class="settings-row plugin-collapsible-head">
        <div class="profile-info">
          <strong>{session.text.pluginsDailyMaterialsSettings}</strong>
          <p>{session.text.pluginsDailyMaterialsHint}</p>
        </div>
        <div class="settings-row-actions">
          <span class="status-badge" data-state={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled ? "ready" : "disconnected"}>{pluginsStore.pluginsEdit.memoryDailyMaterials.enabled ? session.text.pluginEnabled : session.text.pluginDisabled}</span>
          <button class:active={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled} class="switch" type="button" role="switch" aria-label={session.text.memoryDailyMaterialsEnabled} aria-checked={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled} onclick={() => setDailyMaterialsEnabled(!pluginsStore.pluginsEdit!.memoryDailyMaterials.enabled)}><span></span></button>
          <button class="secondary-button plugin-collapsible-toggle" type="button" aria-expanded={expandedPlugin === "dailyMaterials"} onclick={() => togglePluginExpanded("dailyMaterials")}>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
            <span>{expandedPlugin === "dailyMaterials" ? session.text.pluginCollapse : session.text.pluginEdit}</span>
          </button>
        </div>
      </div>
      {#if expandedPlugin === "dailyMaterials"}
        <div class="plugin-collapsible-body">
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
        </div>
      {/if}
    </section>

    <!-- Feature plugins (e.g. Cloudflare HTML Publish) -->
    {#each pluginsStore.plugins.featureSettings as plugin (plugin.pluginKey)}
      {@const enabledField = plugin.fields.find((field) => field.key === "enabled" && field.type === "boolean")}
      {@const enabledValue = Boolean(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.enabled)}
      <section class="plugin-collapsible" class:is-open={expandedPlugin === plugin.pluginKey}>
        <div class="settings-row plugin-collapsible-head">
          <div class="profile-info">
            <strong>{plugin.name}</strong>
            <p>{plugin.description || session.text.pluginsFeatureSettings}</p>
          </div>
          <div class="settings-row-actions">
            <span class="status-badge" data-state={enabledValue ? "ready" : "disconnected"}>{enabledValue ? session.text.pluginEnabled : session.text.pluginDisabled}</span>
            {#if enabledField}
              <button class:active={enabledValue} class="switch" type="button" role="switch" aria-label={enabledField.label} aria-checked={enabledValue} onclick={() => updatePluginValue(plugin.pluginKey, "enabled", !enabledValue)}><span></span></button>
            {/if}
            <button class="secondary-button plugin-collapsible-toggle" type="button" aria-expanded={expandedPlugin === plugin.pluginKey} onclick={() => togglePluginExpanded(plugin.pluginKey)}>
              <i class="ph ph-caret-right" aria-hidden="true"></i>
              <span>{expandedPlugin === plugin.pluginKey ? session.text.pluginCollapse : session.text.pluginEdit}</span>
            </button>
          </div>
        </div>
        {#if expandedPlugin === plugin.pluginKey}
          <div class="plugin-collapsible-body">
            <div class="settings-form">
              {#each plugin.fields as field (`${plugin.pluginKey}:${field.key}`)}
                {#if field.key === "enabled" && field.type === "boolean"}
                  <!-- skip: enabled is exposed on the collapsed head -->
                {:else if field.type === "boolean"}
                  <div class="settings-row settings-field-wide"><div><strong>{field.label}</strong>{#if field.description}<p>{field.description}</p>{/if}</div><button class:active={Boolean(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key])} class="switch" type="button" role="switch" aria-label={field.label} aria-checked={Boolean(pluginsStore.pluginsEdit?.values[plugin.pluginKey]?.[field.key])} onclick={() => updatePluginValue(plugin.pluginKey, field.key, !Boolean(pluginsStore.pluginsEdit?.values[plugin.pluginKey]?.[field.key]))}><span></span></button></div>
                {:else if field.type === "select"}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><select value={String(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key] ?? field.value)} onchange={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)}>{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select>{#if field.description}<small>{field.description}</small>{/if}</label>
                {:else if field.type === "password"}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input type="password" value={pluginsStore.pluginsEdit!.secretValues[plugin.pluginKey]?.[field.key] ?? ""} placeholder={field.configured ? session.text.channelSecretConfigured : field.placeholder} autocomplete="new-password" oninput={(event) => updatePluginSecret(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.configured}<label class="inline-check"><input type="checkbox" checked={pluginsStore.pluginsEdit!.clearSecrets[plugin.pluginKey]?.includes(field.key)} onchange={() => togglePluginSecretClear(plugin.pluginKey, field.key)} /> {session.text.channelClearSecret}</label>{/if}{#if field.description}<small>{field.description}</small>{/if}</label>
                {:else}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input value={String(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key] ?? field.value)} placeholder={field.placeholder} oninput={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.description}<small>{field.description}</small>{/if}</label>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </form>
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

{#if pluginsStore.actionMessage}<p class="settings-action-message">{pluginsStore.actionMessage}</p>{/if}

<style>
  .plugin-collapsible-list {
    padding: 0;
    background: transparent;
    box-shadow: none;
  }
  .plugin-collapsible {
    background: var(--card-bg);
    border: 1px solid var(--hairline);
    border-radius: var(--rounded-md);
    overflow: hidden;
  }
  .plugin-collapsible + .plugin-collapsible {
    margin-top: 12px;
  }
  .plugin-collapsible-head {
    min-height: 56px;
  }
  .plugin-collapsible-head .profile-info {
    min-width: 0;
  }
  .plugin-collapsible-head .profile-info strong {
    font-size: 14px;
    font-weight: 550;
  }
  .plugin-collapsible-head .profile-info p {
    margin: 2px 0 0;
    color: var(--label-secondary);
    font-size: 12px;
    line-height: 1.4;
  }
  .plugin-collapsible-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .plugin-collapsible-toggle i {
    transition: transform var(--duration-fast) var(--ease-standard);
    font-size: 12px;
  }
  .plugin-collapsible.is-open .plugin-collapsible-toggle i {
    transform: rotate(90deg);
  }
  .plugin-collapsible-body {
    padding: 4px 16px 14px;
    border-top: 0.5px solid var(--hairline);
    background: var(--surface-secondary);
  }
  .plugin-collapsible-body .settings-form {
    margin-top: 12px;
  }
  .plugin-collapsible-body .settings-row {
    padding-left: 0;
    padding-right: 0;
  }
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

<script lang="ts">
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import NativeTimeInput from "../components/ui/NativeTimeInput.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
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
  import {
    startDailyMaterialsBackfill,
    loadDailyMaterialsBackfillStatus,
    loadExternalSubagentStatus,
    installExternalSubagentRuntime,
    type ExternalSubagentStatusResponse
  } from "../api";
  import type { DailyMaterialsBackfillStatus } from "@molibot/desktop-contract";

  let subagentStatus = $state<ExternalSubagentStatusResponse | null>(null);
  let checkingSubagent = $state(false);
  let installingProvider = $state<string | null>(null);

  async function refreshSubagentStatus(): Promise<void> {
    if (!session.endpoint) return;
    checkingSubagent = true;
    try {
      const codexPath = String(pluginsStore.pluginsEdit?.values["external-subagent"]?.codexPath ?? "");
      const claudePath = String(pluginsStore.pluginsEdit?.values["external-subagent"]?.claudeCodePath ?? "");
      subagentStatus = await loadExternalSubagentStatus(session.endpoint, {
        codexPath,
        claudeCodePath: claudePath
      });
    } catch {
      // ignore
    } finally {
      checkingSubagent = false;
    }
  }

  async function installSubagent(provider: "codex" | "claude-code"): Promise<void> {
    if (!session.endpoint || installingProvider !== null) return;
    installingProvider = provider;
    try {
      const res = await installExternalSubagentRuntime(session.endpoint, provider);
      if (res.ok) {
        await refreshSubagentStatus();
      } else {
        pluginsStore.actionMessage = res.error || "Installation failed";
      }
    } catch (e) {
      pluginsStore.actionMessage = e instanceof Error ? e.message : String(e);
    } finally {
      installingProvider = null;
    }
  }

  $effect(() => {
    if (expandedPlugin === "external-subagent" && session.endpoint && !subagentStatus && !checkingSubagent) {
      void refreshSubagentStatus();
    }
  });

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
          <IosSwitch checked={pluginsStore.pluginsEdit.memoryEnabled} ariaLabel={session.text.pluginsMemoryEnabled} onCheckedChange={setMemoryEnabled} />
          <button class="secondary-button plugin-collapsible-toggle" type="button" aria-expanded={expandedPlugin === "memory"} onclick={() => togglePluginExpanded("memory")}>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
            <span>{expandedPlugin === "memory" ? session.text.pluginCollapse : session.text.pluginEdit}</span>
          </button>
        </div>
      </div>
      {#if expandedPlugin === "memory"}
        <div class="plugin-collapsible-body">
          <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryBackend}</span><SelectControl value={pluginsStore.pluginsEdit.memoryBackend} ariaLabel={session.text.memoryBackend} options={pluginsStore.plugins.memory.backends} onChange={(value) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryBackend: value }; }} /></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryEmbeddingProvider}</span><SelectControl value={pluginsStore.pluginsEdit.memoryEmbeddingProviderId} ariaLabel={session.text.memoryEmbeddingProvider} options={[{ value: "", label: session.text.unavailable }, ...pluginsStore.plugins.memory.embeddingProviders]} onChange={(value) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryEmbeddingProviderId: value }; }} /></label><label class="settings-field"><span>{session.text.memoryEmbeddingModel}</span><input bind:value={pluginsStore.pluginsEdit.memoryEmbeddingModel} placeholder="text-embedding-3-small" /></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryReflectionTime}</span><NativeTimeInput bind:value={pluginsStore.pluginsEdit.memoryReflectionTime} /></label><div class="settings-row"><div><strong>{session.text.memoryReflectionNotifications}</strong><p>{session.text.memoryReflectionNotificationsHint}</p></div><IosSwitch checked={pluginsStore.pluginsEdit.memoryReflectionNotifications} ariaLabel={session.text.memoryReflectionNotifications} onCheckedChange={(checked) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryReflectionNotifications: checked }; }} /></div></div>
          <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryReflectionNotificationTarget}</span><SelectControl value={pluginsStore.pluginsEdit.memoryReflectionNotificationTarget} ariaLabel={session.text.memoryReflectionNotificationTarget} disabled={!pluginsStore.pluginsEdit.memoryReflectionNotifications && !pluginsStore.pluginsEdit.memoryDailyMaterials.notifications} options={[{ value: "", label: session.text.memoryReflectionNotificationTargetEmpty }, ...pluginsStore.plugins.memory.reflectionNotificationTargets]} onChange={(value) => pluginsStore.pluginsEdit!.memoryReflectionNotificationTarget = value} /><small class="settings-field-hint">{session.text.memoryReflectionNotificationTargetHint}</small></label></div>
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
          <IosSwitch checked={pluginsStore.pluginsEdit.memoryDailyMaterials.enabled} ariaLabel={session.text.memoryDailyMaterialsEnabled} onCheckedChange={setDailyMaterialsEnabled} />
          <button class="secondary-button plugin-collapsible-toggle" type="button" aria-expanded={expandedPlugin === "dailyMaterials"} onclick={() => togglePluginExpanded("dailyMaterials")}>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
            <span>{expandedPlugin === "dailyMaterials" ? session.text.pluginCollapse : session.text.pluginEdit}</span>
          </button>
        </div>
      </div>
      {#if expandedPlugin === "dailyMaterials"}
        <div class="plugin-collapsible-body">
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsTime}</span><NativeTimeInput bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.time} /></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsProject}</span><SelectControl value={pluginsStore.pluginsEdit.memoryDailyMaterials.projectId} ariaLabel={session.text.memoryDailyMaterialsProject} options={[{ value: "", label: session.text.memoryDailyMaterialsProjectEmpty }, ...pluginsStore.plugins.memory.projects]} onChange={(value) => pluginsStore.pluginsEdit!.memoryDailyMaterials.projectId = value} /></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsDir}</span><input bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.dir} /></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsPrompt}</span><input bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.promptPath} /></label></div>
          <div class="settings-form"><label class="settings-field"><span>{session.text.memoryDailyMaterialsBudget}</span><input type="number" min="8000" max="900000" step="1000" bind:value={pluginsStore.pluginsEdit.memoryDailyMaterials.scanTokenBudget} /><small class="settings-field-hint">{session.text.memoryDailyMaterialsBudgetHint}</small></label><label class="settings-field"><span>{session.text.memoryDailyMaterialsModel}</span><SelectControl value={pluginsStore.pluginsEdit.memoryDailyMaterials.scanModelKey} ariaLabel={session.text.memoryDailyMaterialsModel} options={[{ value: "", label: session.text.memoryDailyMaterialsModelDefault }, ...pluginsStore.plugins.memory.scanModels]} onChange={(value) => pluginsStore.pluginsEdit!.memoryDailyMaterials.scanModelKey = value} /><small class="settings-field-hint">{session.text.memoryDailyMaterialsModelHint}</small></label></div>
          <div class="settings-row"><div><strong>{session.text.memoryDailyMaterialsNotifications}</strong><p>{session.text.memoryDailyMaterialsNotificationsHint}</p></div><IosSwitch checked={pluginsStore.pluginsEdit.memoryDailyMaterials.notifications} ariaLabel={session.text.memoryDailyMaterialsNotifications} onCheckedChange={(checked) => { if (pluginsStore.pluginsEdit) pluginsStore.pluginsEdit = { ...pluginsStore.pluginsEdit, memoryDailyMaterials: { ...pluginsStore.pluginsEdit.memoryDailyMaterials, notifications: checked } }; }} /></div>
          <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.memoryReflectionNotificationTarget}</span><SelectControl value={pluginsStore.pluginsEdit.memoryReflectionNotificationTarget} ariaLabel={session.text.memoryReflectionNotificationTarget} disabled={!pluginsStore.pluginsEdit.memoryReflectionNotifications && !pluginsStore.pluginsEdit.memoryDailyMaterials.notifications} options={[{ value: "", label: session.text.memoryReflectionNotificationTargetEmpty }, ...pluginsStore.plugins.memory.reflectionNotificationTargets]} onChange={(value) => pluginsStore.pluginsEdit!.memoryReflectionNotificationTarget = value} /><small class="settings-field-hint">{session.text.memoryReflectionNotificationTargetHint}</small></label></div>
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
              <IosSwitch checked={enabledValue} ariaLabel={enabledField.label} onCheckedChange={(checked) => updatePluginValue(plugin.pluginKey, "enabled", checked)} />
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
                  <div class="settings-row settings-field-wide"><div><strong>{field.label}</strong>{#if field.description}<p>{field.description}</p>{/if}</div><IosSwitch checked={Boolean(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key])} ariaLabel={field.label} onCheckedChange={(checked) => updatePluginValue(plugin.pluginKey, field.key, checked)} /></div>
                {:else if field.type === "select"}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><SelectControl value={String(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key] ?? field.value)} ariaLabel={field.label} options={field.options} onChange={(value) => updatePluginValue(plugin.pluginKey, field.key, value)} />{#if field.description}<small>{field.description}</small>{/if}</label>
                {:else if field.type === "password"}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input type="password" value={pluginsStore.pluginsEdit!.secretValues[plugin.pluginKey]?.[field.key] ?? ""} placeholder={field.configured ? session.text.channelSecretConfigured : field.placeholder} autocomplete="new-password" oninput={(event) => updatePluginSecret(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.configured}<label class="inline-check"><input type="checkbox" checked={pluginsStore.pluginsEdit!.clearSecrets[plugin.pluginKey]?.includes(field.key)} onchange={() => togglePluginSecretClear(plugin.pluginKey, field.key)} /> {session.text.channelClearSecret}</label>{/if}{#if field.description}<small>{field.description}</small>{/if}</label>
                {:else}
                  <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input value={String(pluginsStore.pluginsEdit!.values[plugin.pluginKey]?.[field.key] ?? field.value)} placeholder={field.placeholder} oninput={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.description}<small>{field.description}</small>{/if}</label>
                {/if}
              {/each}

              {#if plugin.pluginKey === "external-subagent"}
                <div class="ext-status-panel">
                  <div class="ext-status-head">
                    <div>
                      <strong>{session.text.externalSubagentStatus}</strong>
                      <p>{session.text.externalSubagentStatusHint}</p>
                    </div>
                    <button
                      class="secondary-button"
                      type="button"
                      disabled={checkingSubagent}
                      onclick={refreshSubagentStatus}
                    >
                      <i class="ph ph-arrows-clockwise" class:spin={checkingSubagent} aria-hidden="true"></i>
                      <span>{checkingSubagent ? session.text.externalSubagentChecking : session.text.externalSubagentCheck}</span>
                    </button>
                  </div>

                  {#if subagentStatus}
                    <div class="ext-status-list">
                      <div class="ext-status-row">
                        <div class="ext-status-info">
                          <div class="ext-status-title">
                            <strong>OpenAI Codex</strong>
                            <span class="status-badge" data-state={subagentStatus.codex.available ? "ready" : "disconnected"}>
                              {subagentStatus.codex.available ? session.text.externalSubagentDetected : session.text.externalSubagentNotFound}
                            </span>
                          </div>
                          {#if subagentStatus.codex.executablePath || subagentStatus.codex.packagePath}
                            <span class="ext-status-path">{subagentStatus.codex.source ? `[${subagentStatus.codex.source}] ` : ""}{subagentStatus.codex.executablePath || subagentStatus.codex.packagePath}</span>
                          {:else if subagentStatus.codex.error}
                            <span class="ext-status-error">{subagentStatus.codex.error}</span>
                          {/if}
                        </div>
                        {#if !subagentStatus.codex.available}
                          <button
                            class="secondary-button"
                            type="button"
                            disabled={installingProvider !== null}
                            onclick={() => installSubagent("codex")}
                          >
                            {installingProvider === "codex" ? session.text.externalSubagentInstalling : session.text.externalSubagentInstall}
                          </button>
                        {/if}
                      </div>

                      <div class="ext-status-row">
                        <div class="ext-status-info">
                          <div class="ext-status-title">
                            <strong>Claude Code</strong>
                            <span class="status-badge" data-state={subagentStatus.claudeCode.available ? "ready" : "disconnected"}>
                              {subagentStatus.claudeCode.available ? session.text.externalSubagentDetected : session.text.externalSubagentNotFound}
                            </span>
                          </div>
                          {#if subagentStatus.claudeCode.executablePath || subagentStatus.claudeCode.packagePath}
                            <span class="ext-status-path">{subagentStatus.claudeCode.source ? `[${subagentStatus.claudeCode.source}] ` : ""}{subagentStatus.claudeCode.executablePath || subagentStatus.claudeCode.packagePath}</span>
                          {:else if subagentStatus.claudeCode.error}
                            <span class="ext-status-error">{subagentStatus.claudeCode.error}</span>
                          {/if}
                        </div>
                        {#if !subagentStatus.claudeCode.available}
                          <button
                            class="secondary-button"
                            type="button"
                            disabled={installingProvider !== null}
                            onclick={() => installSubagent("claude-code")}
                          >
                            {installingProvider === "claude-code" ? session.text.externalSubagentInstalling : session.text.externalSubagentInstall}
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </form>
{/if}

<!-- No Mini App surfaces here. Browsing and installing apps belongs to the
     sidebar's Mini Apps destination, and the AI capability settings are a model
     route, so they live in Settings › Models with the others. -->

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
    font-weight: 500;
  }
  .plugin-collapsible-head .profile-info p {
    margin: 2px 0 0;
    color: var(--label-secondary);
    font-size: 12px;
    line-height: var(--lh-prose);
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
    line-height: var(--lh-prose);
  }
  .daily-backfill-status.is-error {
    color: var(--danger);
  }
  .settings-field-hint {
    margin-top: 4px;
    color: var(--label-secondary);
    font-size: 12px;
    line-height: var(--lh-prose);
  }
  .ext-status-panel {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid var(--hairline);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
  }
  .ext-status-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .ext-status-head strong {
    font-size: 13px;
    font-weight: 500;
  }
  .ext-status-head p {
    margin: 2px 0 0;
    color: var(--label-secondary);
    font-size: 11px;
  }
  .ext-status-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ext-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border-radius: var(--rounded-sm);
    background: var(--surface-secondary);
  }
  .ext-status-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ext-status-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ext-status-title strong {
    font-size: 13px;
  }
  .ext-status-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--label-secondary);
    word-break: break-all;
  }
  .ext-status-error {
    font-size: 11px;
    color: var(--danger);
  }
</style>

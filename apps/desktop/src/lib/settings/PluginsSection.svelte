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

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== pluginsStore.endpoint) {
      void loadPlugins(session.endpoint);
    }
  });

  const pluginsDirty = $derived(pluginsStore.pluginsEdit !== null && JSON.stringify(pluginsStore.pluginsEdit) !== pluginsStore.pristine);
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
